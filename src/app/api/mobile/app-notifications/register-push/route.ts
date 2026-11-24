import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMobileUser } from "@/lib/mobileCouple";

/* Register (or refresh) an Expo push token for the couple app (xpress-client).
   Separate from staff device_tokens — see app_device_tokens (migration 00241). */
export async function POST(req: Request) {
  const caller = await requireMobileUser(req);
  if (caller instanceof NextResponse) return caller;

  const { expoPushToken, platform, deviceName } = (await req.json().catch(() => ({}))) as {
    expoPushToken?: string;
    platform?: string;
    deviceName?: string;
  };
  const pushToken = (expoPushToken ?? "").toString().trim();
  if (!pushToken) {
    return NextResponse.json({ error: "expoPushToken is required" }, { status: 400 });
  }

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from("app_device_tokens").upsert(
    {
      auth_user_id: caller.userId,
      expo_push_token: pushToken,
      platform: platform ?? null,
      device_name: deviceName ?? null,
      is_active: true,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "expo_push_token" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
