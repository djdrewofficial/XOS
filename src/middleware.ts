import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  moduleForPath,
  resolveAccessMap,
  accessAtLeast,
  isOwnerEmail,
  TWO_FA_REQUIRED_ROLES,
  ROLES,
  type Access,
  type Role,
} from "@/lib/permissions";
import {
  PERM_COOKIE,
  PERM_TTL_SEC,
  permCacheSecret,
  readPermSnap,
  signPermSnap,
  type PermSnap,
} from "@/lib/permSnapshot";
import { decideMfaGate } from "@/lib/mfaGate";
import { MFA_EMAIL_COOKIE, readMfaEmailStepUp, sessionIdFromAccessToken } from "@/lib/mfaStepUpCookie";
import { MFA_PASSKEY_COOKIE, readMfaPasskeyStepUp } from "@/lib/passkeyStepUpCookie";

/** Supabase Auth "Send SMS" hook. Supabase's servers POST the phone OTP here
    with no staff session and no Cloudflare `x-origin-verify` header (the call
    is not browser traffic, and a direct hit on the Netlify origin never gets
    the header). Exempt this exact path from both the origin lock and the
    login wall. Do not widen it to `/api/auth/*` — those pages stay session-gated.
    The request is authenticated by the Standard Webhooks signature
    (SEND_SMS_HOOK_SECRET) inside the route, not by the shared origin secret. */
function isAuthSendSmsHook(pathname: string) {
  return pathname === "/api/auth/hooks/send-sms";
}

/** Sign-in for another app (/sso/*): remember where to come back to after login/2FA. */
function withNext(url: URL, request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  url.search = pathname.startsWith("/sso/") ? `?next=${encodeURIComponent(pathname + search)}` : "";
  return url;
}

type PendingCookie = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

type Gate =
  | { kind: "external"; accountType: "client" | "event_guest" }
  | { kind: "nostaff" }
  | { kind: "staff"; role: Role; empId: string | null; can: Record<string, Access> | null };

function isRole(value: string): value is Role {
  return ROLES.some(([id]) => id === value);
}

function isAccess(value: string): value is Access {
  return value === "none" || value === "view" || value === "edit";
}

/** A signed snapshot is trusted only when its shape matches what the gate stores. */
function gateFromSnap(snap: PermSnap | null): Gate | null {
  if (!snap || !isRole(snap.role)) return null;
  if (snap.accountType !== "staff") {
    return { kind: "external", accountType: snap.accountType };
  }
  if (snap.role === "master_admin") {
    return { kind: "staff", role: "master_admin", empId: snap.empId, can: null };
  }
  if (!snap.empId) return { kind: "nostaff" };
  if (!snap.can) return null;
  const can: Record<string, Access> = {};
  for (const [key, value] of Object.entries(snap.can)) {
    if (!isAccess(value)) return null;
    can[key] = value;
  }
  return { kind: "staff", role: snap.role, empId: snap.empId, can };
}

export async function middleware(request: NextRequest) {
  // Origin lock: force all human/staff traffic through Cloudflare's WAF. A
  // Cloudflare Transform Rule stamps a secret header on every proxied request;
  // direct hits to the raw *.netlify.app origin lack it and are refused, so an
  // attacker can't reach the app around the firewall. Fails OPEN when the secret
  // isn't set (inert until configured) and skips machine endpoints (webhooks /
  // cron / mobile) that self-authenticate and may be invoked off-Cloudflare.
  const originSecret = process.env.ORIGIN_VERIFY_SECRET;
  if (originSecret) {
    const p = request.nextUrl.pathname;
    const machineEndpoint =
      isAuthSendSmsHook(p) ||
      p.startsWith("/api/vibo/") || p.startsWith("/api/spotify/") ||
      p.startsWith("/api/mailgun/") || p.startsWith("/api/highlevel/") ||
      p.startsWith("/api/paypal/") || p.startsWith("/api/pay/") ||
      p.startsWith("/api/places") || p.startsWith("/api/mobile/") ||
      p.startsWith("/api/music/") || p.startsWith("/api/cron/") ||
      p.startsWith("/api/unsubscribe/") || p.startsWith("/api/fireflies/") ||
      p.startsWith("/api/comms-delivery");
    if (!machineEndpoint && request.headers.get("x-origin-verify") !== originSecret) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  let response = NextResponse.next({ request });
  // Session refreshes write cookies onto whichever response we actually return.
  // Redirects used to drop them, which invalidated the rotated refresh token and
  // left the next click hanging or logged out until a full reload.
  let pendingAuthCookies: PendingCookie[] = [];
  let permSet: { value: string; maxAge: number } | null = null;
  let clearMfaCookie = false;
  let clearPasskeyCookie = false;

  const finish = (res: NextResponse) => {
    for (const c of pendingAuthCookies) res.cookies.set(c.name, c.value, c.options);
    if (clearMfaCookie) {
      res.cookies.set(MFA_EMAIL_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
    }
    if (clearPasskeyCookie) {
      res.cookies.set(MFA_PASSKEY_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
    }
    if (permSet) {
      res.cookies.set(PERM_COOKIE, permSet.value, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: permSet.maxAge,
      });
    }
    return res;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          pendingAuthCookies = cookiesToSet;
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.cookies.get(MFA_EMAIL_COOKIE)) clearMfaCookie = true;
  if (!user && request.cookies.get(MFA_PASSKEY_COOKIE)) clearPasskeyCookie = true;

  const { pathname } = request.nextUrl;
  // PUBLIC routes: client signing links + machine endpoints (webhook/cron do
  // their own auth — Mailgun HMAC and the CRON_SECRET bearer token; /api/mobile
  // verifies the XOS Mobile app's Supabase JWT itself). /api/auth/hooks/send-sms
  // is the one Auth path in this list: no session, signature checked in the route.
  // /auth/* stays public so password reset works with no session:
  //   /auth/forgot-password  request a Supabase reset email
  //   /auth/set-password     land from that email and choose a new password
  // (also the staff invite / admin reset landing). /login is public below.
  const isPublic =
    isAuthSendSmsHook(pathname) ||
    pathname.startsWith("/app-privacy") ||
    pathname.startsWith("/app-terms") ||
    pathname.startsWith("/app-data-deletion") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/sign/") ||
    pathname.startsWith("/j/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/pay/") ||
    pathname.startsWith("/welcome/") ||
    pathname.startsWith("/proposal/") ||
    pathname.startsWith("/offer/") ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/vibo/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/vibo/") ||
    pathname.startsWith("/api/spotify/") ||
    pathname.startsWith("/api/mailgun/") ||
    pathname.startsWith("/api/fireflies/") ||
    pathname.startsWith("/api/highlevel/") ||
    pathname.startsWith("/api/paypal/") ||
    pathname.startsWith("/api/pay/") ||
    pathname.startsWith("/api/places") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/api/music/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/unsubscribe/") ||
    pathname.startsWith("/api/comms-delivery") ||
    pathname === "/api/passkey/authenticate/options" ||
    pathname === "/api/passkey/authenticate/verify";
  if (isPublic) return finish(response);

  const isLoginPage = pathname.startsWith("/login");
  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    permSet = { value: "", maxAge: 0 };
    return finish(NextResponse.redirect(withNext(url, request)));
  }
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return finish(NextResponse.redirect(url));
  }

  // Permission gate: block screens the signed-in user lacks "view" access to.
  // Master Admin bypasses; a user with no employee row is denied (routed to
  // /no-access) unless they match the OWNER_EMAILS break-glass list. /no-access
  // maps to no module, so redirecting there can never loop. The gate fails OPEN
  // on any unexpected error — a guard must never take the whole app down
  // (sensitive money/reports pages re-check server-side anyway).
  if (user) {
    try {
      // Assurance level is read from the session JWT (no extra network hop) and
      // overlaps the permission lookup on a cache miss.
      const aalPromise = supabase.auth.mfa
        .getAuthenticatorAssuranceLevel()
        .then((r) => r.data)
        .catch(() => null);

      const secret = permCacheSecret();
      const cached = gateFromSnap(
        await readPermSnap(request.cookies.get(PERM_COOKIE)?.value, secret, user.id),
      );

      let gate: Gate;
      if (cached) {
        gate = cached;
      } else {
        const [{ data: acct }, { data: emp }] = await Promise.all([
          supabase.from("accounts").select("account_type").eq("auth_user_id", user.id).maybeSingle(),
          supabase.from("employees").select("id, permission_tier").eq("auth_user_id", user.id).maybeSingle(),
        ]);

        if (acct && acct.account_type !== "staff") {
          const accountType = acct.account_type === "event_guest" ? "event_guest" : "client";
          gate = { kind: "external", accountType };
          if (secret) {
            permSet = {
              value: await signPermSnap(
                { uid: user.id, exp: Math.floor(Date.now() / 1000) + PERM_TTL_SEC, accountType, role: "employee", empId: null },
                secret,
              ),
              maxAge: PERM_TTL_SEC,
            };
          }
        } else if (emp && isRole(emp.permission_tier)) {
          const role = emp.permission_tier;
          const empId = emp.id as string;
          let can: Record<string, Access> | null = null;
          if (role !== "master_admin") {
            const [{ data: roleRows }, { data: userRows }] = await Promise.all([
              supabase.from("role_permissions").select("module, access").eq("role", role),
              supabase.from("employee_permissions").select("module, access").eq("employee_id", empId),
            ]);
            can = resolveAccessMap(
              role,
              (roleRows ?? []) as { module: string; access: Access }[],
              (userRows ?? []) as { module: string; access: Access }[],
            );
          }
          gate = { kind: "staff", role, empId, can };
          if (secret) {
            permSet = {
              value: await signPermSnap(
                {
                  uid: user.id,
                  exp: Math.floor(Date.now() / 1000) + PERM_TTL_SEC,
                  accountType: "staff",
                  role,
                  empId,
                  ...(can ? { can } : {}),
                },
                secret,
              ),
              maxAge: PERM_TTL_SEC,
            };
          }
        } else if (isOwnerEmail(user.email)) {
          gate = { kind: "staff", role: "master_admin", empId: null, can: null };
          if (secret) {
            permSet = {
              value: await signPermSnap(
                {
                  uid: user.id,
                  exp: Math.floor(Date.now() / 1000) + PERM_TTL_SEC,
                  accountType: "staff",
                  role: "master_admin",
                  empId: null,
                },
                secret,
              ),
              maxAge: PERM_TTL_SEC,
            };
          }
        } else {
          gate = { kind: "nostaff" };
          if (secret) {
            permSet = {
              value: await signPermSnap(
                {
                  uid: user.id,
                  exp: Math.floor(Date.now() / 1000) + PERM_TTL_SEC,
                  accountType: "staff",
                  role: "employee",
                  empId: null,
                },
                secret,
              ),
              maxAge: PERM_TTL_SEC,
            };
          }
        }
      }

      if (gate.kind === "external") {
        if (!pathname.startsWith("/portal")) {
          const url = request.nextUrl.clone();
          url.pathname = "/portal";
          url.search = "";
          return finish(NextResponse.redirect(url));
        }
        return finish(response);
      }

      if (gate.kind === "nostaff") {
        if (!pathname.startsWith("/no-access")) {
          const url = request.nextUrl.clone();
          url.pathname = "/no-access";
          url.search = "";
          return finish(NextResponse.redirect(url));
        }
        return finish(response);
      }

      // Sign-in gate. Authenticator and text codes are Supabase factors: a
      // verified one makes nextLevel aal2, and the session has to reach aal2.
      // Email codes and passkeys are not Supabase factors. A signed cookie
      // bound to this session is the proof, and a passkey proof is enough on
      // its own. Every staff role has to enroll a passkey or a second factor.
      // An assurance-lookup failure still fails open, except an email factor
      // or a passkey already on the user is still required.
      const aal = await aalPromise;
      const emailEnrolled = user.app_metadata?.email_mfa === true;
      const passkeyEnrolled = user.app_metadata?.passkey_mfa === true;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const sessionId = sessionIdFromAccessToken(session?.access_token);
      const stepUpSecret = permCacheSecret();
      const emailStepUp = emailEnrolled
        ? await readMfaEmailStepUp(request.cookies.get(MFA_EMAIL_COOKIE)?.value, stepUpSecret, user.id, sessionId)
        : false;
      const passkeyStepUp = await readMfaPasskeyStepUp(
        request.cookies.get(MFA_PASSKEY_COOKIE)?.value,
        stepUpSecret,
        user.id,
        sessionId,
      );
      const decision = decideMfaGate({
        aalKnown: Boolean(aal),
        currentLevel: aal?.currentLevel,
        nextLevel: aal?.nextLevel,
        emailEnrolled,
        emailStepUp,
        passkeyEnrolled,
        passkeyStepUp,
        roleRequiresMfa: TWO_FA_REQUIRED_ROLES.has(gate.role),
      });
      // Passkey register/step-up routes enforce their own session checks.
      // Redirecting them would turn the ceremony into an HTML login page.
      const passkeyApi = pathname.startsWith("/api/passkey/");
      if (decision === "challenge" && !pathname.startsWith("/2fa") && !passkeyApi) {
        const url = request.nextUrl.clone();
        url.pathname = "/2fa";
        return finish(NextResponse.redirect(withNext(url, request)));
      }
      if (decision === "enroll" && !pathname.startsWith("/account/security") && !passkeyApi) {
        const url = request.nextUrl.clone();
        url.pathname = "/account/security";
        url.search = "";
        return finish(NextResponse.redirect(url));
      }

      const moduleKey = moduleForPath(pathname);
      if (moduleKey && gate.role !== "master_admin") {
        const can = gate.can ?? {};
        if (!accessAtLeast(can[moduleKey] ?? "none", "view")) {
          const url = request.nextUrl.clone();
          url.pathname = "/no-access";
          url.search = "";
          return finish(NextResponse.redirect(url));
        }
      }
    } catch (err) {
      console.error("permission gate error (failing open):", err);
    }
  }

  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
