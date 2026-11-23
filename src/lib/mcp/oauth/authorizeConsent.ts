import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mcpIssuer } from "./config";
import { completeAuthorize, type AuthorizeQuery } from "./server";
import type { OAuthStore } from "./store";
import type { AuthorizeUser } from "./types";

/** HttpOnly SameSite=Lax cookie holding the signed consent CSRF token. */
export const AUTHORIZE_CSRF_COOKIE = "mcp_oauth_csrf";
export const AUTHORIZE_CSRF_TTL_SEC = 10 * 60;

/** Domain-separation label for deriving the CSRF HMAC key from a raw secret. */
export const CSRF_KEY_CONTEXT = "xos-mcp-oauth-csrf-v1";

/**
 * POST authorize redirects must use 303 See Other so browsers follow with GET.
 * NextResponse.redirect defaults to 307, which would re-POST to redirect_uri /login.
 */
export const AUTHORIZE_POST_REDIRECT_STATUS = 303 as const;

export const AUTHORIZE_SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};

type CsrfPayload = {
  uid: string;
  nonce: string;
  exp: number;
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string | null;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
};

/** Derive a domain-separated HMAC key from a raw secret (never sign with the raw key alone). */
export function deriveCsrfSigningKey(raw: string): Buffer {
  return createHmac("sha256", raw).update(CSRF_KEY_CONTEXT).digest();
}

/**
 * Resolve the raw CSRF secret. Prefer MCP_OAUTH_CSRF_SECRET, then service role / cron.
 * Production fails closed when none are set; dev/test falls back to a local default.
 */
export function resolveCsrfRawSecret(): string {
  const candidates = [
    process.env.MCP_OAUTH_CSRF_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.CRON_SECRET,
  ];
  for (const value of candidates) {
    if (value && value.length >= 16) return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MCP OAuth CSRF secret is not configured");
  }
  return "xos-mcp-oauth-csrf-dev";
}

function csrfSigningKey(rawOverride?: string): Buffer {
  return deriveCsrfSigningKey(rawOverride ?? resolveCsrfRawSecret());
}

function safeEqualStr(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signPayload(payload: CsrfPayload, key: Buffer): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function parseToken(token: string, key: Buffer): CsrfPayload | null {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!data || !sig) return null;
  const expect = createHmac("sha256", key).update(data).digest("base64url");
  if (!safeEqualStr(sig, expect)) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as CsrfPayload;
  } catch {
    return null;
  }
}

function canonicalQuery(query: AuthorizeQuery): Omit<CsrfPayload, "uid" | "nonce" | "exp"> | null {
  if (
    !query.response_type ||
    !query.client_id ||
    !query.redirect_uri ||
    !query.code_challenge ||
    !query.code_challenge_method
  ) {
    return null;
  }
  return {
    response_type: query.response_type,
    client_id: query.client_id,
    redirect_uri: query.redirect_uri,
    scope: query.scope,
    state: query.state,
    code_challenge: query.code_challenge,
    code_challenge_method: query.code_challenge_method,
    resource: query.resource,
  };
}

function paramsMatch(payload: CsrfPayload, query: AuthorizeQuery): boolean {
  const q = canonicalQuery(query);
  if (!q) return false;
  return (
    payload.response_type === q.response_type &&
    payload.client_id === q.client_id &&
    payload.redirect_uri === q.redirect_uri &&
    payload.scope === q.scope &&
    payload.state === q.state &&
    payload.code_challenge === q.code_challenge &&
    payload.code_challenge_method === q.code_challenge_method &&
    payload.resource === q.resource
  );
}

/** Mint a signed CSRF token bound to the signed-in user and exact authorize params. */
export function mintAuthorizeCsrf(
  userId: string,
  query: AuthorizeQuery,
  now = new Date(),
  /** Optional raw secret override (still domain-separated via deriveCsrfSigningKey). */
  rawSecret?: string,
): string {
  const canon = canonicalQuery(query);
  if (!canon) throw new Error("incomplete authorize query for CSRF");
  const payload: CsrfPayload = {
    uid: userId,
    nonce: randomBytes(18).toString("base64url"),
    exp: Math.floor(now.getTime() / 1000) + AUTHORIZE_CSRF_TTL_SEC,
    ...canon,
  };
  return signPayload(payload, csrfSigningKey(rawSecret));
}

/**
 * Double-submit CSRF check: cookie token must equal form token, signature must
 * verify, uid must match the signed-in user, params must match the POST body,
 * and the token must not be expired.
 */
export function verifyAuthorizeCsrf(args: {
  formToken: string | null | undefined;
  cookieToken: string | null | undefined;
  userId: string;
  query: AuthorizeQuery;
  now?: Date;
  /** Optional raw secret override (still domain-separated). */
  secret?: string;
}): boolean {
  const formToken = args.formToken?.trim() || "";
  const cookieToken = args.cookieToken?.trim() || "";
  if (!formToken || !cookieToken) return false;
  if (!safeEqualStr(formToken, cookieToken)) return false;
  const payload = parseToken(formToken, csrfSigningKey(args.secret));
  if (!payload) return false;
  const nowSec = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (payload.exp < nowSec) return false;
  if (payload.uid !== args.userId) return false;
  return paramsMatch(payload, args.query);
}

/**
 * Accept Origin when it matches any allowed origin (request URL origin and/or
 * the canonical public issuer behind Cloudflare/Netlify). Missing Origin is rejected.
 */
export function originAllowed(originHeader: string | null, ...allowedOrigins: string[]): boolean {
  if (!originHeader || allowedOrigins.length === 0) return false;
  let got: string;
  try {
    got = new URL(originHeader).origin;
  } catch {
    return false;
  }
  for (const allowed of allowedOrigins) {
    try {
      if (got === new URL(allowed).origin) return true;
    } catch {
      /* skip invalid allowed entry */
    }
  }
  return false;
}

/** Origins accepted for authorize POST (request host + canonical mcpIssuer). */
export function authorizeAllowedOrigins(requestOrigin: string, issuer = mcpIssuer()): string[] {
  return [requestOrigin, issuer];
}

export function escHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Host/origin shown on the consent screen (full URI also available). */
export function redirectDisplay(redirectUri: string): { origin: string; href: string } {
  try {
    const u = new URL(redirectUri);
    return { origin: u.origin, href: u.toString() };
  } catch {
    return { origin: redirectUri, href: redirectUri };
  }
}

export type ConsentPageInput = {
  clientName: string;
  redirectUri: string;
  accountLabel: string;
  csrfToken: string;
  query: AuthorizeQuery;
};

/** Minimal Allow / Cancel confirmation HTML (no scope picker). */
export function renderAuthorizeConsentHtml(input: ConsentPageInput): string {
  const { origin, href } = redirectDisplay(input.redirectUri);
  const q = input.query;
  const hidden = (name: string, value: string | null) =>
    value == null
      ? ""
      : `<input type="hidden" name="${escHtml(name)}" value="${escHtml(value)}">`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Allow MCP access</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#17122b;font-family:-apple-system,system-ui,sans-serif;color:#2c2c33;padding:16px;box-sizing:border-box}
.card{background:#fff;border-radius:18px;padding:28px;max-width:420px;width:100%}
h1{font-size:18px;margin:0 0 8px}
p{font-size:14px;line-height:1.5;color:#5c5c66;margin:0 0 12px}
.meta{font-size:13px;background:#f4f2f8;border-radius:12px;padding:12px 14px;margin:0 0 20px;word-break:break-all}
.meta strong{display:block;color:#2c2c33;margin-bottom:4px}
.meta span{color:#5c5c66}
.actions{display:flex;gap:10px}
button{flex:1;border:0;border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:pointer}
.allow{color:#fff;background:linear-gradient(135deg,#4b328e,#8b6fd6)}
.cancel{color:#2c2c33;background:#eceaf2}
.note{font-size:12px;color:#8a8794;margin:16px 0 0}
</style>
</head>
<body>
<form class="card" method="post" action="/api/mcp/oauth/authorize">
<h1>Allow MCP access?</h1>
<p><strong>${escHtml(input.clientName)}</strong> wants to connect to XOS using your staff permissions.</p>
<div class="meta">
<strong>Redirects to</strong>
<span>${escHtml(origin)}</span>
<span style="display:block;margin-top:6px;font-size:12px">${escHtml(href)}</span>
</div>
<div class="meta">
<strong>Signed in as</strong>
<span>${escHtml(input.accountLabel)}</span>
</div>
<input type="hidden" name="csrf" value="${escHtml(input.csrfToken)}">
${hidden("response_type", q.response_type)}
${hidden("client_id", q.client_id)}
${hidden("redirect_uri", q.redirect_uri)}
${hidden("scope", q.scope)}
${hidden("state", q.state)}
${hidden("code_challenge", q.code_challenge)}
${hidden("code_challenge_method", q.code_challenge_method)}
${hidden("resource", q.resource)}
<div class="actions">
<button class="cancel" type="submit" name="decision" value="deny">Cancel</button>
<button class="allow" type="submit" name="decision" value="allow">Allow</button>
</div>
<p class="note">Permissions come from your XOS role. Only continue if you started this connection.</p>
</form>
</body>
</html>`;
}

export function csrfCookieOptions(maxAgeSec: number): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/mcp/oauth/authorize",
    maxAge: maxAgeSec,
  };
}

export type ConsentDecisionResult =
  | { ok: true; kind: "allow"; redirectTo: string; grantTokenId: string }
  | { ok: true; kind: "deny"; redirectError: "access_denied"; state: string | null }
  | {
      ok: false;
      status: number;
      error: string;
      error_description?: string;
      /** When true, the route must not clear the CSRF cookie (e.g. untrusted Origin). */
      preserveCsrfCookie?: boolean;
    };

/**
 * CSRF-gated Allow / Cancel decision used by POST /api/mcp/oauth/authorize.
 * Does not create a grant or code unless decision is allow and CSRF verifies.
 */
export async function processAuthorizeConsentDecision(args: {
  store: OAuthStore;
  decision: string | null;
  formToken: string | null | undefined;
  cookieToken: string | null | undefined;
  originHeader: string | null;
  requestOrigin: string;
  /** Canonical public issuer origin (mcpIssuer); accepted alongside requestOrigin. */
  issuerOrigin?: string;
  userId: string;
  user: AuthorizeUser;
  query: AuthorizeQuery;
  now?: Date;
  secret?: string;
}): Promise<ConsentDecisionResult> {
  const allowed = authorizeAllowedOrigins(args.requestOrigin, args.issuerOrigin ?? args.requestOrigin);
  if (!originAllowed(args.originHeader, ...allowed)) {
    return {
      ok: false,
      status: 403,
      error: "invalid_request",
      error_description: "Invalid request origin",
      preserveCsrfCookie: true,
    };
  }

  const csrfOk = verifyAuthorizeCsrf({
    formToken: args.formToken,
    cookieToken: args.cookieToken,
    userId: args.userId,
    query: args.query,
    now: args.now,
    secret: args.secret,
  });
  if (!csrfOk) {
    return { ok: false, status: 403, error: "invalid_request", error_description: "Invalid or missing CSRF token" };
  }

  if (args.decision === "deny") {
    return { ok: true, kind: "deny", redirectError: "access_denied", state: args.query.state };
  }
  if (args.decision !== "allow") {
    return { ok: false, status: 400, error: "invalid_request", error_description: "decision must be allow or deny" };
  }

  const completed = await completeAuthorize(args.store, args.query, args.user, args.now);
  if (!completed.ok) {
    return {
      ok: false,
      status: completed.status,
      error: completed.body.error,
      error_description: completed.body.error_description,
    };
  }
  return {
    ok: true,
    kind: "allow",
    redirectTo: completed.value.redirectTo,
    grantTokenId: completed.value.grantTokenId,
  };
}
