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

  const finish = (res: NextResponse) => {
    for (const c of pendingAuthCookies) res.cookies.set(c.name, c.value, c.options);
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

  const { pathname } = request.nextUrl;
  // PUBLIC routes: client signing links + machine endpoints (webhook/cron do
  // their own auth — Mailgun HMAC and the CRON_SECRET bearer token; /api/mobile
  // verifies the XOS Mobile app's Supabase JWT itself).
  // /auth/* stays public so password reset works with no session:
  //   /auth/forgot-password  request a Supabase reset email
  //   /auth/set-password     land from that email and choose a new password
  // (also the staff invite / admin reset landing). /login is public below.
  const isPublic =
    pathname.startsWith("/app-privacy") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/sign/") ||
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
    pathname.startsWith("/api/comms-delivery");
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

      // 2FA gate. Anyone with an enrolled factor must complete the TOTP challenge
      // (aal1 -> aal2). Master admins, admins, and salespeople MUST have 2FA — if
      // they haven't set it up, force them to the setup page first. Regular
      // employees may opt in. Fails open on a lookup error so an MFA hiccup can
      // never lock staff out.
      const aal = await aalPromise;
      if (aal) {
        const hasFactor = aal.nextLevel === "aal2";
        if (hasFactor && aal.currentLevel === "aal1" && !pathname.startsWith("/2fa")) {
          const url = request.nextUrl.clone();
          url.pathname = "/2fa";
          return finish(NextResponse.redirect(withNext(url, request)));
        }
        if (!hasFactor && TWO_FA_REQUIRED_ROLES.has(gate.role) && !pathname.startsWith("/account/security")) {
          const url = request.nextUrl.clone();
          url.pathname = "/account/security";
          url.search = "";
          return finish(NextResponse.redirect(url));
        }
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
