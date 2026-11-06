import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingRelation } from "@/lib/eventAccessServer";
import { revokeAppleAuthorization } from "@/lib/appleSignIn";
import { readAppleAuthorizationCode, runAppAccountDeletion, type AppAccountType } from "@/lib/deleteAppAccount";

/* Self-serve account deletion for the couples app (App Store 5.1.1(v)).
   Deletes the signed-in person's login and app membership: the accounts row,
   event_app_members, and this login's push tokens. Then the auth user.

   Never deletes a staff login. Never deletes events, clients, event guests,
   payments, or booking agreements. Those stay with Xpress.

   Optional body { appleAuthorizationCode } is exchanged and revoked with Apple.
   A revoke failure is logged and does not stop deletion.
   POST with an empty body is allowed. */

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await rls.auth.getUser(token);
  if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userData.user.id;

  const body = await req.json().catch(() => null);
  const appleAuthorizationCode = readAppleAuthorizationCode(body);

  const admin = createAdminClient();
  const [{ data: acct }, { data: employee }] = await Promise.all([
    admin.from("accounts").select("account_type, employee_id").eq("auth_user_id", uid).maybeSingle(),
    admin.from("employees").select("id").eq("auth_user_id", uid).maybeSingle(),
  ]);
  const accountType = acct?.account_type;
  const kind: AppAccountType =
    accountType === "staff" || accountType === "client" || accountType === "event_guest" ? accountType : null;

  const result = await runAppAccountDeletion({
    accountType: kind,
    employeeId: (acct?.employee_id as string | null) ?? null,
    linkedEmployee: Boolean(employee?.id),
    appleAuthorizationCode,
    env: {
      APPLE_SIGNIN_KEY_ID: process.env.APPLE_SIGNIN_KEY_ID,
      APPLE_SIGNIN_PRIVATE_KEY: process.env.APPLE_SIGNIN_PRIVATE_KEY,
      APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
      APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    },
    revoke: revokeAppleAuthorization,
    log: (message) => console.error(message),
    removeAppData: async () => {
      await admin.from("device_tokens").delete().eq("auth_user_id", uid);
      const { error: memberErr } = await admin.from("event_app_members").delete().eq("auth_user_id", uid);
      if (memberErr && !isMissingRelation(memberErr)) console.error(memberErr.message);
      await admin.from("accounts").delete().eq("auth_user_id", uid);
    },
    deleteAuthUser: async () => {
      const { error } = await admin.auth.admin.deleteUser(uid);
      return error ? error.message : null;
    },
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
