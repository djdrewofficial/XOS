import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/* Self-serve account deletion for the couples/guests mobile app (App Store
   Guideline 5.1.1(v)). The signed-in user deletes THEIR OWN login: we remove the
   `accounts` link row and the Supabase auth user, so they can no longer sign in.

   We intentionally KEEP the underlying clients / event_guests / event records —
   those are the DJ's business/CRM data, not the app user's to erase. To use the
   app again the person must be re-invited by staff (Events@xpressdjs.com), which
   recreates their login. JWT-verified via the /api/mobile/ prefix. */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify the token → the caller may only delete themselves.
  const rls = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userData, error: userErr } = await rls.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userData.user.id;

  const admin = createAdminClient();

  // If this login is a staff member, detach the legacy employees.auth_user_id
  // pointer so it doesn't dangle at a deleted auth user.
  const { data: acct } = await admin
    .from("accounts")
    .select("account_type, employee_id")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (acct?.employee_id) {
    await admin.from("employees").update({ auth_user_id: null }).eq("id", acct.employee_id);
  }

  // Remove the login: the accounts link row, then the auth user itself.
  await admin.from("accounts").delete().eq("auth_user_id", uid);
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    return NextResponse.json({ error: "Could not delete the account. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
