import { NextResponse } from "next/server";
import { createClient as createAnonClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { getMe, getMobileMe, type Me } from "@/lib/auth";
import { accessAtLeast, type Access } from "@/lib/permissions";

/* Resolve the signed-in user for an API route from EITHER a cookie session
   (the XOS web app) OR an Authorization: Bearer <supabase access token> header
   (the Xpress client mobile app, which has no cookies). Returns a Supabase
   client scoped to that user (RLS-authenticated) plus the user, or nulls. */
export async function resolveApiUser(req: Request): Promise<{
  supabase: SupabaseClient;
  userId: string | null;
}> {
  const auth = req.headers.get("authorization") ?? "";
  if (/^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "");
    const supabase = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data } = await supabase.auth.getUser(token);
    return { supabase, userId: data.user?.id ?? null };
  }
  const supabase = await createCookieClient();
  const { data } = await supabase.auth.getUser();
  return { supabase: supabase as unknown as SupabaseClient, userId: data.user?.id ?? null };
}

/* ── Staff RBAC guards for /api/* handlers ─────────────────────────────────
   The middleware permission gate maps every /api/* path to no module (see
   moduleForPath in lib/permissions), so it lets API requests through without a
   module check. Every cookie-authenticated staff API route MUST therefore
   enforce its own access. These helpers are the one place that does it, each
   returning a ready-to-send JSON error Response (401/403) on failure so a route
   can guard in a single line. (Machine endpoints that self-authenticate — cron,
   webhooks, the /api/mobile/* JWT domain, the public client-payment / music /
   places routes — do NOT use these; they aren't staff/cookie authed.) */

type Client = SupabaseClient;

/** Guard an API handler by module access. Returns null when the signed-in user
    has at least `need` access to `moduleKey` (proceed), or a JSON error Response
    (401 not signed in / 403 lacking access) the route must return immediately.

      const denied = await requireApiModule("inbox", "view", supabase);
      if (denied) return denied;
*/
export async function requireApiModule(
  moduleKey: string,
  need: Access = "view",
  supabase?: Client,
): Promise<NextResponse | null> {
  const me = await getMe(supabase);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!accessAtLeast(me.can[moduleKey] ?? "none", need)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Require a signed-in staff user and hand back their Me, or a 401 Response. Use
    when the handler needs the identity itself — e.g. to filter results per
    module (see the global search route). Narrow with an instanceof check:

      const me = await requireApiUser(supabase);
      if (me instanceof NextResponse) return me;   // me is now typed as Me
*/
export async function requireApiUser(supabase?: Client): Promise<Me | NextResponse> {
  const me = await getMe(supabase);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return me;
}

/** Guard an API handler so only the master admin (owner) may proceed. Returns
    null when allowed, else a 403 Response. Route-level mirror of requireMaster. */
export async function requireApiMaster(supabase?: Client): Promise<NextResponse | null> {
  const me = await getMe(supabase);
  if (!me || me.accountType !== "staff" || me.role !== "master_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/* ── Mobile (Bearer-token) staff RBAC ──────────────────────────────────────
   The XOS Mobile app authenticates with a Supabase access token, not cookies,
   so /api/mobile/* is exempt from the middleware login-wall AND its RBAC gate.
   Those handlers historically checked only "is this a staff login" (via RLS or
   resolveEventRole), NOT the per-screen module access the web enforces — so a
   staffer restricted on the web (e.g. inbox=none) could still perform the action
   from the app. This helper closes that: it resolves the caller's real Me from
   the JWT (getMobileMe → identical RBAC to the web) and applies the same module
   gate the matching web server action uses. `supabase` must be the anon client
   built with the caller's Bearer token in its Authorization header. */

/** Require the mobile caller to be a STAFF login with at least `need` access to
    `moduleKey`. Returns null when allowed, else a JSON error Response (401 invalid
    token / 403 not staff or lacking module access). */
export async function requireMobileStaffModule(
  supabase: Client,
  token: string,
  moduleKey: string,
  need: Access = "view",
): Promise<NextResponse | null> {
  const me = await getMobileMe(supabase, token);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.accountType !== "staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!accessAtLeast(me.can[moduleKey] ?? "none", need)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
