import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSmsOutbox, toE164 } from "@/lib/highlevel";

/* PUBLIC (middleware-exempt). Lets a client text their partner/planner an
   invite to join the Vibo event. Body: { token, name, phone }. Sends via the
   same SMS outbox XOS uses everywhere. The pay_token is the authorization.
   Because the recipient is by design NOT on file (a partner/planner), we can't
   match it against a stored number — instead we normalize the phone, strip the
   attacker-controllable name, and rate-limit invites per event so this can't be
   used as an open SMS relay. */

export const dynamic = "force-dynamic";

const MAX_INVITES_PER_HOUR = 5;

export async function POST(req: Request) {
  let body: { token?: string; name?: string; phone?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  // Strip newlines/controls and cap length — `name` is interpolated into the SMS.
  const name = (body.name ?? "").toString().replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 60);
  const e164 = toE164((body.phone ?? "").toString());
  if (!token) return NextResponse.json({ error: "Missing link." }, { status: 400 });
  if (!e164) return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: ev } = await supabase
    .from("events")
    .select("id, name, custom_fields, client:clients(first_name, last_name)")
    .eq("pay_token", token)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "Invalid link." }, { status: 404 });

  // Rate limit: cap invite texts per event per hour (anti-relay).
  const sinceHr = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("sms_log")
    .select("id", { count: "exact", head: true })
    .eq("event_id", ev.id)
    .gt("created_at", sinceHr)
    .ilike("body", "%join Vibo%");
  if ((count ?? 0) >= MAX_INVITES_PER_HOUR) {
    return NextResponse.json({ error: "Too many invites just now — please try again a little later." }, { status: 429 });
  }

  const c = ev.client as { first_name?: string; last_name?: string } | null;
  const clientName = `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || "your partner";
  const link = ((ev.custom_fields as Record<string, string>) ?? {}).vibo_link || "";
  const hi = name ? `Hey ${name}, ` : "Hi! ";
  const msg = `${hi}${clientName} is inviting you to join Vibo to plan ${ev.name || "the event"} entertainment together!${link ? ` Join here: ${link}` : ""}`;

  const { error } = await supabase.from("sms_log").insert({ event_id: ev.id, to_number: e164, body: msg, status: "queued" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await processSmsOutbox(supabase);
  return NextResponse.json({ ok: true });
}
