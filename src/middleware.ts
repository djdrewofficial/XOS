import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  moduleForPath,
  resolveAccessMap,
  accessAtLeast,
  type Access,
  type Role,
} from "@/lib/permissions";

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
      p.startsWith("/api/music/") || p.startsWith("/api/cron/");
    if (!machineEndpoint && request.headers.get("x-origin-verify") !== originSecret) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
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
  // verifies the XOS Mobile app's Supabase JWT itself)
  const isPublic =
    pathname.startsWith("/sign/") ||
    pathname.startsWith("/pay/") ||
    pathname.startsWith("/welcome/") ||
    pathname.startsWith("/proposal/") ||
    pathname.startsWith("/vibo/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/vibo/") ||
    pathname.startsWith("/api/spotify/") ||
    pathname.startsWith("/api/mailgun/") ||
    pathname.startsWith("/api/highlevel/") ||
    pathname.startsWith("/api/paypal/") ||
    pathname.startsWith("/api/pay/") ||
    pathname.startsWith("/api/places") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/api/music/") ||
    pathname.startsWith("/api/cron/");
  if (isPublic) return response;

  const isLoginPage = pathname.startsWith("/login");
  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Permission gate: block screens the signed-in user lacks "view" access to.
  // Master Admin (and anyone with no employee row) bypasses. /no-access maps to
  // no module, so redirecting there can never loop. The gate fails OPEN on any
  // unexpected error — a guard must never take the whole app down (sensitive
  // money/reports pages re-check server-side anyway).
  if (user) {
    try {
      // External users (client / event guest) live in the planning portal only.
      const { data: acct } = await supabase
        .from("accounts")
        .select("account_type")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (acct && acct.account_type !== "staff") {
        if (!pathname.startsWith("/portal")) {
          const url = request.nextUrl.clone();
          url.pathname = "/portal";
          url.search = "";
          return NextResponse.redirect(url);
        }
        return response; // external user inside the portal — allowed
      }

      // 2FA gate: a staff member with an enrolled factor must complete the TOTP
      // challenge (aal1 -> aal2) before reaching the app. Fails open on a lookup
      // error so an MFA hiccup can never lock staff out.
      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2" && !pathname.startsWith("/2fa")) {
          const url = request.nextUrl.clone();
          url.pathname = "/2fa";
          url.search = "";
          return NextResponse.redirect(url);
        }
      } catch {
        /* never block on an MFA lookup failure */
      }

      const moduleKey = moduleForPath(pathname);
      if (moduleKey) {
        const { data: emp } = await supabase
          .from("employees")
          .select("id, permission_tier")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        const role = ((emp?.permission_tier as Role | undefined) ?? "master_admin") as Role;
        if (role !== "master_admin") {
          const empId = (emp?.id as string | undefined) ?? null;
          const [{ data: roleRows }, { data: userRows }] = await Promise.all([
            supabase.from("role_permissions").select("module, access").eq("role", role),
            empId
              ? supabase.from("employee_permissions").select("module, access").eq("employee_id", empId)
              : Promise.resolve({ data: [] as { module: string; access: Access }[] }),
          ]);
          const can = resolveAccessMap(
            role,
            (roleRows ?? []) as { module: string; access: Access }[],
            (userRows ?? []) as { module: string; access: Access }[],
          );
          if (!accessAtLeast(can[moduleKey] ?? "none", "view")) {
            const url = request.nextUrl.clone();
            url.pathname = "/no-access";
            url.search = "";
            return NextResponse.redirect(url);
          }
        }
      }
    } catch (err) {
      console.error("permission gate error (failing open):", err);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
