import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPayInfo } from "@/lib/payInfo";

/* PUBLIC (middleware-exempt). The client tapped "I've sent my Zelle" on the
   welcome page. We don't record a payment yet — an unconfirmed claim shouldn't
   reduce their balance — we just flag the office (note + notification) to
   confirm and record it when the money lands. */

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

  await supabase.from("event_notes").insert({
    event_id: info.eventId,
    body: `💸 ${who} marked a Zelle payment of ${amt} as sent — confirm it arrived, then record the payment.`,
    author_name: "client (pay page)",
  });
  await supabase.rpc("create_notification", {
    p_type: "payment",
    p_title: `Zelle marked sent: ${amt}`,
    p_body: `${who} · ${info.eventName ?? "event"} — confirm and record when received.`,
    p_href: `/events/${info.eventId}`,
  });

  return NextResponse.json({ ok: true });
}
