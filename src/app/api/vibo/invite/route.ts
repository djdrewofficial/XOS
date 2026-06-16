import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSmsOutbox } from "@/lib/highlevel";

/* PUBLIC (middleware-exempt). Lets a client text their partner/planner an
   invite to join the Vibo event. Body: { token, name, phone }. Sends via the
   same SMS outbox XOS uses everywhere. The pay_token is the authorization. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: string; name?: string; phone?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  const name = (body.name ?? "").toString().trim();
  const phone = (body.phone ?? "").toString().trim();
  if (!token || !phone) return NextResponse.json({ error: "Missing phone." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: ev } = await supabase
    .from("events")
    .select("id, name, custom_fields, client:clients(first_name, last_name)")
    .eq("pay_token", token)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "Invalid link." }, { status: 404 });

  const c = ev.client as { first_name?: string; last_name?: string } | null;
  const clientName = `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || "your partner";
  const link = ((ev.custom_fields as Record<string, string>) ?? {}).vibo_link ?? "";
  const hi = name ? `Hey ${name}, ` : "Hi! ";
  const msg = `${hi}${clientName} is inviting you to join Vibo to plan ${ev.name || "the event"} entertainment together!${link ? ` Join here: ${link}` : ""}`;

  const { error } = await supabase.from("sms_log").insert({ event_id: ev.id, to_number: phone, body: msg, status: "queued" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await processSmsOutbox(supabase);
  return NextResponse.json({ ok: true });
}
