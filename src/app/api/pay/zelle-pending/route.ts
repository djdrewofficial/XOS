import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPayInfo } from "@/lib/payInfo";
import { payVerifyRequired, isPayVerified, PAY_SESSION_COOKIE } from "@/lib/payVerify";
import { isRateLimited, recordRateHit } from "@/lib/rateLimit";

const HOUR = 60 * 60 * 1000;

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

  if (await payVerifyRequired(supabase)) {
    const sess = (await cookies()).get(PAY_SESSION_COOKIE)?.value ?? null;
    if (!(await isPayVerified(supabase, token, sess))) {
      return NextResponse.json({ error: "Please verify your phone to continue." }, { status: 401 });
    }
  }

  // Nothing owed → no claim (would insert a meaningless $0 pending row).
  if (info.balance <= 0) {
    return NextResponse.json({ error: "This booking is already paid in full — nothing is owed." }, { status: 400 });
  }

  // Dedupe: if there's already an open (pending, not-removed) Zelle claim for this
  // event, don't insert another row / note / notification — repeated "I've sent my
  // Zelle" taps just return ok until the office confirms or removes the first one.
  const { data: openClaim } = await supabase
    .from("payments")
    .select("id")
    .eq("event_id", info.eventId)
    .eq("status", "pending")
    .eq("method", "zelle")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (openClaim) return NextResponse.json({ ok: true, deduped: true });

  // Per-event backstop so distinct claims can't be spammed rapidly.
  if (await isRateLimited(supabase, "zelle_pending:event", info.eventId, 3, HOUR)) {
    return NextResponse.json(
      { error: "We've already logged your Zelle note — please give us a moment to confirm it." },
      { status: 429 },
    );
  }
  await recordRateHit(supabase, "zelle_pending:event", info.eventId, HOUR);

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
