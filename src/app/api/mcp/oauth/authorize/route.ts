import { NextRequest, NextResponse } from "next/server";
import {
  AUTHORIZE_CSRF_COOKIE,
  AUTHORIZE_CSRF_TTL_SEC,
  AUTHORIZE_POST_REDIRECT_STATUS,
  AUTHORIZE_SECURITY_HEADERS,
  authorizeAllowedOrigins,
  csrfCookieOptions,
  mintAuthorizeCsrf,
  originAllowed,
  processAuthorizeConsentDecision,
  renderAuthorizeConsentHtml,
} from "@/lib/mcp/oauth/authorizeConsent";
import { mcpIssuer } from "@/lib/mcp/oauth/config";
import { validateAuthorizeRequest, type AuthorizeQuery } from "@/lib/mcp/oauth/server";
import { resolveOAuthStaffUser } from "@/lib/mcp/oauth/staffUser";
import { supabaseOAuthStore } from "@/lib/mcp/oauth/supabaseOAuthStore";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth 2.1 authorization endpoint.
 * GET shows a one-click Allow / Cancel confirmation for signed-in staff
 * (permissions still come from the XOS role; no scope picker).
 * POST Allow issues the authorization code after CSRF + Origin checks.
 * Unsigned-in visitors go to /login and return here.
 */

function withSecurityHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(AUTHORIZE_SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

function readAuthorizeQuery(get: (key: string) => string | null): AuthorizeQuery {
  return {
    response_type: get("response_type"),
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    scope: get("scope"),
    state: get("state"),
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method"),
    resource: get("resource"),
  };
}

function clearCsrfCookie(res: NextResponse) {
  res.cookies.set(AUTHORIZE_CSRF_COOKIE, "", { ...csrfCookieOptions(0), maxAge: 0 });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const store = supabaseOAuthStore(createAdminClient());
  const query = readAuthorizeQuery((k) => url.searchParams.get(k));

  const validated = await validateAuthorizeRequest(store, query);
  if (!validated.ok) {
    return withSecurityHeaders(
      await redirectOAuthError(store, query, validated.body.error, validated.body.error_description, validated.status),
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Always send humans to the canonical public origin (xos.xpressdjs.com).
    // The raw *.netlify.app host 403s GETs (/login, .well-known) via origin lock.
    const login = new URL("/login", mcpIssuer());
    const returnPath = `${url.pathname}${url.search}`;
    login.searchParams.set("next", returnPath);
    return withSecurityHeaders(NextResponse.redirect(login));
  }

  const staff = await resolveOAuthStaffUser(createAdminClient(), {
    id: user.id,
    email: user.email,
  });
  if (!staff) {
    return withSecurityHeaders(
      await redirectOAuthError(store, query, "access_denied", "Sign in with an XOS staff account", 403),
    );
  }

  // Never issue a grant or auth code on GET. Staff must click Allow on POST.
  const csrfToken = mintAuthorizeCsrf(staff.userId, query);
  const html = renderAuthorizeConsentHtml({
    clientName: validated.value.clientName,
    redirectUri: validated.value.redirectUri,
    accountLabel: user.email || staff.displayName,
    csrfToken,
    query,
  });
  const res = withSecurityHeaders(
    new NextResponse(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
  res.cookies.set(AUTHORIZE_CSRF_COOKIE, csrfToken, csrfCookieOptions(AUTHORIZE_CSRF_TTL_SEC));
  return res;
}

export async function POST(req: NextRequest) {
  const url = req.nextUrl;
  const store = supabaseOAuthStore(createAdminClient());
  const issuer = mcpIssuer();
  const allowedOrigins = authorizeAllowedOrigins(url.origin, issuer);

  // Reject untrusted Origin before any Set-Cookie that would clear CSRF.
  // An attacker site must not be able to wipe a staff user's consent cookie.
  if (!originAllowed(req.headers.get("origin"), ...allowedOrigins)) {
    return withSecurityHeaders(
      NextResponse.json(
        { error: "invalid_request", error_description: "Invalid request origin" },
        { status: 403 },
      ),
    );
  }

  const form = await req.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" ? v : null;
  };
  const query = readAuthorizeQuery(field);
  const decision = field("decision");
  const formCsrf = field("csrf");
  const cookieCsrf = req.cookies.get(AUTHORIZE_CSRF_COOKIE)?.value ?? null;

  const validated = await validateAuthorizeRequest(store, query);
  if (!validated.ok) {
    const res = withSecurityHeaders(
      await redirectOAuthError(
        store,
        query,
        validated.body.error,
        validated.body.error_description,
        validated.status,
        AUTHORIZE_POST_REDIRECT_STATUS,
      ),
    );
    clearCsrfCookie(res);
    return res;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const login = new URL("/login", issuer);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (typeof v === "string" && v) qs.set(k, v);
    }
    login.searchParams.set("next", `/api/mcp/oauth/authorize?${qs.toString()}`);
    const res = withSecurityHeaders(NextResponse.redirect(login, AUTHORIZE_POST_REDIRECT_STATUS));
    clearCsrfCookie(res);
    return res;
  }

  const staff = await resolveOAuthStaffUser(createAdminClient(), {
    id: user.id,
    email: user.email,
  });
  if (!staff) {
    const res = withSecurityHeaders(
      await redirectOAuthError(
        store,
        query,
        "access_denied",
        "Sign in with an XOS staff account",
        403,
        AUTHORIZE_POST_REDIRECT_STATUS,
      ),
    );
    clearCsrfCookie(res);
    return res;
  }

  const result = await processAuthorizeConsentDecision({
    store,
    decision,
    formToken: formCsrf,
    cookieToken: cookieCsrf,
    originHeader: req.headers.get("origin"),
    requestOrigin: url.origin,
    issuerOrigin: issuer,
    userId: staff.userId,
    user: {
      userId: staff.userId,
      displayName: staff.displayName,
      scopes: staff.scopes,
    },
    query,
  });

  if (!result.ok) {
    const res = withSecurityHeaders(
      NextResponse.json(
        { error: result.error, error_description: result.error_description },
        { status: result.status },
      ),
    );
    if (!result.preserveCsrfCookie) clearCsrfCookie(res);
    return res;
  }

  if (result.kind === "deny") {
    const res = withSecurityHeaders(
      await redirectOAuthError(
        store,
        query,
        "access_denied",
        "The resource owner denied the request",
        403,
        AUTHORIZE_POST_REDIRECT_STATUS,
      ),
    );
    clearCsrfCookie(res);
    return res;
  }

  const res = withSecurityHeaders(NextResponse.redirect(result.redirectTo, AUTHORIZE_POST_REDIRECT_STATUS));
  clearCsrfCookie(res);
  return res;
}

async function redirectOAuthError(
  store: ReturnType<typeof supabaseOAuthStore>,
  query: {
    client_id: string | null;
    redirect_uri: string | null;
    state: string | null;
  },
  error: string,
  description: string | undefined,
  status: number,
  /** POST callers must pass 303 so browsers do not re-POST to redirect_uri. */
  redirectStatus?: number,
) {
  if (query.client_id && query.redirect_uri) {
    const client = await store.findClient(query.client_id);
    if (client?.redirect_uris.includes(query.redirect_uri)) {
      const target = new URL(query.redirect_uri);
      target.searchParams.set("error", error);
      if (description) target.searchParams.set("error_description", description);
      if (query.state) target.searchParams.set("state", query.state);
      return redirectStatus != null
        ? NextResponse.redirect(target.toString(), redirectStatus)
        : NextResponse.redirect(target.toString());
    }
  }
  return NextResponse.json(
    { error, error_description: description },
    { status },
  );
}
