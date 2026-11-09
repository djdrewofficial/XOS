import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMobileStaffModule } from "@/lib/apiAuth";
import { getMobileMe } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutbox } from "@/lib/mailgun";
import { processSmsOutbox } from "@/lib/highlevel";

/* Drain the email + SMS outboxes immediately — called by the XOS Mobile app
   right after it queues work (booking helpers, template emails, texts), so
   sends are instant like the web instead of waiting for the 10-min cron.
   Auth: the app's Supabase JWT as a Bearer token (route is middleware-exempt).
   Gated on inbox=edit (the messaging-send capability) so a staffer who can't
   send messages on the web can't flush the outbox from the app either. */
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
  const me = await getMobileMe(supabase, token);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // field staff queue texts with inbox VIEW (send-sms checks the DJ rule) and
  // their session can't read what the drain enriches with (00218): drain
  // service-role for them. The drain only sends what's already queued.
  const denied = await requireMobileStaffModule(supabase, token, "inbox", me.fieldStaff ? "view" : "edit");
  if (denied) return denied;
  const drainer = me.fieldStaff ? createAdminClient() : supabase;

  const [email, sms] = await Promise.all([
    processOutbox(drainer),
    processSmsOutbox(drainer),
  ]);
  return NextResponse.json({ ok: true, email, sms });
}
