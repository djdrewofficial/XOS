import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { capturePaypalOrder, isPaypalConfigured, paypalConfigStatus } from "@/lib/paypal";
import { loadPayInfo } from "@/lib/payInfo";
import { recordPaypalPayment } from "@/lib/paypalRecord";
import { payVerifyRequired, isPayVerified, PAY_SESSION_COOKIE } from "@/lib/payVerify";

/* PUBLIC (middleware-exempt). Captures an approved order and records the
   payment. Money only moves on capture; we record only when COMPLETED.
   Recording is idempotent (paypal_capture_id), so the webhook can't double it. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isPaypalConfigured()) {
    return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  }
  // Fail closed: on the live site in sandbox mode, don't capture/record — that would
  // book fake sandbox money against a real balance.
  const cfg = paypalConfigStatus();
  if (!cfg.safeForRealPayments) {
    console.error("[paypal] refusing to capture order —", cfg.issues.join(" | "));
    return NextResponse.json(
      { error: "Card payments are temporarily unavailable — please contact us to pay another way." },
      { status: 503 },
    );
  }
  let body: { token?: string; orderId?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const token = (body.token ?? "").toString();
  const orderId = (body.orderId ?? "").toString();
  if (!token || !orderId) return NextResponse.json({ error: "Missing token or order." }, { status: 400 });

  const supabase = createAdminClient();
  const info = await loadPayInfo(supabase, token);
  if (!info) return NextResponse.json({ error: "This payment link isn't valid." }, { status: 404 });

  if (await payVerifyRequired(supabase, token)) {
    const sess = (await cookies()).get(PAY_SESSION_COOKIE)?.value ?? null;
    if (!(await isPayVerified(supabase, token, sess))) {
      return NextResponse.json({ error: "Please verify your phone to continue." }, { status: 401 });
    }
  }

  // Nothing owed → don't capture. Guards the two-tabs race: if another order (or a
  // Zelle/manual payment) already cleared the balance, we never move money for a
  // second full-balance order. (idempotency is per-capture-id, so it wouldn't dedupe
  // two distinct orders.)
  if (info.balance <= 0) {
    return NextResponse.json({ error: "This event is already paid in full." }, { status: 400 });
  }

  const result = await capturePaypalOrder(orderId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  const { capture } = result;
  if (!capture.completed || !capture.captureId || capture.amount == null) {
    return NextResponse.json({ error: "Payment was not completed." }, { status: 402 });
  }

  // recordPaypalPayment splits the convenience fee out and credits the base.
  const rec = await recordPaypalPayment(supabase, {
    eventId: info.eventId,
    chargedAmount: capture.amount,
    captureId: capture.captureId,
    payerEmail: capture.payerEmail,
    payerName: capture.payerName,
  });

  // Money already moved at PayPal, so we record it — but if the base credited
  // exceeds what was owed at capture time (a truly simultaneous double-capture that
  // slipped past the balance guard), alert staff to reconcile / partial-refund.
  if (rec.recorded && rec.base > info.balance + 0.01) {
    try {
      await supabase.rpc("create_notification", {
        p_type: "system_alert",
        p_title: "PayPal payment exceeds balance",
        p_body: `${info.eventName ?? "Event"}: captured $${rec.base.toFixed(2)} against a $${info.balance.toFixed(2)} balance — may need a partial refund.`,
        p_href: `/events/${info.eventId}`,
      });
    } catch {
      /* alert is best-effort */
    }
  }

  return NextResponse.json({ ok: true, amount: rec.base, fee: rec.fee, charged: capture.amount });
}
