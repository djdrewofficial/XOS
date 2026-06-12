import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";

/* Drain the email + SMS outboxes immediately — called by the XOS Mobile app
   right after it queues work (booking helpers, template emails, texts), so
   sends are instant like the web instead of waiting for the 10-min cron.
   Auth: the app's Supabase JWT as a Bearer token (route is middleware-exempt). */
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

  const [email, sms] = await Promise.all([
    processOutbox(supabase),
    processSmsOutbox(supabase),
  ]);
  return NextResponse.json({ ok: true, email, sms });
}
