import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPayInfo } from "@/lib/payInfo";

/* PUBLIC (middleware-exempt). The client tapped "I've sent my Zelle" on the
   welcome page. We record a PENDING payment (status='pending') so it shows in
   the event's payment log — but pending claims are excluded from the balance
   math everywhere, so an unconfirmed claim never reduces what's owed. The
   office gets a note + a 'zelle_pending' notification to confirm and approve
   it once the money actually lands. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: string; amount?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const supabase = createAdminClient();
  const info = await loadPayInfo(supabase, token);
  if (!info) return NextResponse.json({ error: "This payment link isn't valid." }, { status: 404 });

  const requested = Number(body.amount);
  const amount = Math.min(info.balance, Number.isFinite(requested) && requested > 0 ? requested : info.suggested);
  const amt = amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const who = info.firstName ?? "The client";

  // record as a pending payment so it shows in the Financials payment log;
  // pending rows are excluded from all balance math until the office confirms
  await supabase.from("payments").insert({
    event_id: info.eventId,
    amount,
    method: "zelle",
    status: "pending",
    payer_name: info.firstName ? `${info.firstName}${info.lastName ? " " + info.lastName : ""}` : null,
    reason: "Zelle (client-reported)",
    notes: "Client tapped “I've sent my Zelle” on the pay page — confirm it arrived, then mark received.",
  });

  await supabase.from("event_notes").insert({
    event_id: info.eventId,
    body: `💸 ${who} marked a Zelle payment of ${amt} as sent — confirm it arrived, then mark it received on the Financials tab.`,
    author_name: "client (pay page)",
  });
  await supabase.rpc("create_notification", {
    p_type: "zelle_pending",
    p_title: `Zelle marked sent: ${amt}`,
    p_body: `${who} · ${info.eventName ?? "event"} — confirm and record when received.`,
    p_href: `/events/${info.eventId}`,
  });

  return NextResponse.json({ ok: true });
}
