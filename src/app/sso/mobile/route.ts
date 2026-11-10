import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/auth";
import { TWO_FA_REQUIRED_ROLES } from "@/lib/permissions";
import { decideMfaGate } from "@/lib/mfaGate";
import { MFA_EMAIL_COOKIE, readMfaEmailStepUp, sessionIdFromAccessToken } from "@/lib/mfaStepUpCookie";
import { MFA_PASSKEY_COOKIE, readMfaPasskeyStepUp } from "@/lib/passkeyStepUpCookie";
import { permCacheSecret } from "@/lib/permSnapshot";
import {
  MOBILE_SSO_CODE_TTL_SEC,
  expoHostsFromEnv,
  mobileReturnWith,
  safeMobileReturnUrl,
  signMobileSsoCode,
  validCodeChallenge,
  validState,
} from "@/lib/mobileSso";

/* Sign in to the XOS Staff iPhone app with the web sign-in (passkey, Google,
   Apple, or password + code). See src/lib/mobileSso.ts for the flow.

   Params: r = app return URL, cc = PKCE S256 challenge, s = app state.
   Login-walled and 2FA-gated by the middleware like the gallery hand-off, and
   re-checked here so it fails closed.

   GET only shows a confirm page. The code is issued by a same-origin POST from
   that page, so a link someone else crafted (their own challenge and return
   URL) can't silently hand a signed-in person's session to them. */

export const dynamic = "force-dynamic";

type Params = { returnUrl: string; challenge: string; state: string };

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  return res;
}

function text(body: string, status: number) {
  return noStore(new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } }));
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function readParams(get: (key: string) => string | null): Params | null {
  const returnUrl = safeMobileReturnUrl(get("r"), expoHostsFromEnv(process.env.MOBILE_SSO_EXPO_HOSTS));
  const challenge = get("cc");
  const state = get("s");
  if (!returnUrl || !validCodeChallenge(challenge) || !validState(state)) return null;
  return { returnUrl, challenge, state };
}

/** Same staff + 2FA decision as /sso/gallery. Returns a response to send
    instead (login, /2fa, enroll, refuse), or the signed-in user id. */
async function gate(url: URL, p: Params, here: string): Promise<{ userId: string; email: string | null } | NextResponse> {
  const back = (path: string) => noStore(NextResponse.redirect(new URL(`${path}?next=${encodeURIComponent(here)}`, url), 303));
  const supabase = await createClient();
  const me = await getMe(supabase);
  if (!me) return back("/login");
  if (me.accountType !== "staff") {
    return noStore(NextResponse.redirect(mobileReturnWith(p.returnUrl, { error: "not_staff", s: p.state }), 303));
  }
  const secret = permCacheSecret();
  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || !aal) return text("Couldn't check two-factor sign-in. Try again.", 503);
  const { data: authUser } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionId = sessionIdFromAccessToken(session?.access_token);
  const jar = await cookies();
  const decision = decideMfaGate({
    aalKnown: true,
    currentLevel: aal.currentLevel,
    nextLevel: aal.nextLevel,
    emailEnrolled: authUser.user?.app_metadata?.email_mfa === true,
    emailStepUp: await readMfaEmailStepUp(jar.get(MFA_EMAIL_COOKIE)?.value, secret, me.userId, sessionId),
    passkeyEnrolled: authUser.user?.app_metadata?.passkey_mfa === true,
    passkeyStepUp: await readMfaPasskeyStepUp(jar.get(MFA_PASSKEY_COOKIE)?.value, secret, me.userId, sessionId),
    roleRequiresMfa: TWO_FA_REQUIRED_ROLES.has(me.role),
  });
  if (decision === "challenge") return back("/2fa");
  if (decision === "enroll") return noStore(NextResponse.redirect(new URL("/account/security", url), 303));
  return { userId: me.userId, email: authUser.user?.email ?? null };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = readParams((k) => url.searchParams.get(k));
  if (!p) return text("This sign-in link is incomplete. Start again from the XOS Staff app.", 400);
  const secret = permCacheSecret();
  if (!secret || secret.length < 16) return text("App sign-in isn't available right now.", 503);

  const allowed = await gate(url, p, `${url.pathname}${url.search}`);
  if (allowed instanceof NextResponse) return allowed;

  const who = allowed.email ? esc(allowed.email) : "your XOS login";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>XOS Staff app sign-in</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#17122b;font-family:-apple-system,system-ui,sans-serif;color:#2c2c33;padding:16px;box-sizing:border-box}
.card{background:#fff;border-radius:18px;padding:28px;max-width:360px;width:100%;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#5c5c66;margin:0 0 20px}
button{width:100%;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;color:#fff;background:linear-gradient(135deg,#4b328e,#8b6fd6)}
.small{font-size:12px;margin:16px 0 0}</style></head><body><form class="card" method="post" action="/sso/mobile">
<h1>Sign in to the XOS Staff app?</h1>
<p>Continue as <strong>${who}</strong> in the XOS Staff app on this device.</p>
<input type="hidden" name="r" value="${esc(p.returnUrl)}"><input type="hidden" name="cc" value="${esc(p.challenge)}"><input type="hidden" name="s" value="${esc(p.state)}">
<button type="submit">Continue</button>
<p class="small">Didn't start this from the XOS Staff app? Close this page.</p>
</form></body></html>`;
  return noStore(new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Only our own confirm page may post here.
  const origin = req.headers.get("origin");
  if (!origin || origin !== url.origin) return text("This sign-in link is incomplete. Start again from the XOS Staff app.", 403);
  const form = await req.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" ? v : null;
  };
  const p = readParams(field);
  if (!p) return text("This sign-in link is incomplete. Start again from the XOS Staff app.", 400);
  const secret = permCacheSecret();
  if (!secret || secret.length < 16) return text("App sign-in isn't available right now.", 503);

  const qs = new URLSearchParams({ r: p.returnUrl, cc: p.challenge, s: p.state }).toString();
  const allowed = await gate(url, p, `/sso/mobile?${qs}`);
  if (allowed instanceof NextResponse) return allowed;

  const code = await signMobileSsoCode(
    { uid: allowed.userId, ch: p.challenge, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) + MOBILE_SSO_CODE_TTL_SEC },
    secret,
  );
  return noStore(NextResponse.redirect(mobileReturnWith(p.returnUrl, { code, s: p.state }), 303));
}
