import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* Register (or refresh) an Expo push token for the signed-in staff user. The XOS
   Mobile app calls this after sign-in with the user's Supabase access token
   (Bearer header), same auth model as the other /api/mobile routes. Upserts into
   device_tokens keyed by the unique expo_push_token so re-registering just
   refreshes last_seen_at and re-links the employee. */
export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authUserId = userData.user.id;

  const { expoPushToken, platform, deviceName } = (await req.json().catch(() => ({}))) as {
    expoPushToken?: string;
    platform?: string;
    deviceName?: string;
  };
  const pushToken = (expoPushToken ?? "").toString().trim();
  if (!pushToken) {
    return NextResponse.json({ error: "expoPushToken is required" }, { status: 400 });
  }

  // Map the login to an employee row (null for the owner/unlinked login).
  const { data: emp } = await supabase.from("employees").select("id").eq("auth_user_id", authUserId).maybeSingle();

  const { error } = await supabase
    .from("device_tokens")
    .upsert(
      {
        auth_user_id: authUserId,
        employee_id: emp?.id ?? null,
        expo_push_token: pushToken,
        platform: platform ?? null,
        device_name: deviceName ?? null,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "expo_push_token" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
