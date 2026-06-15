import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { capturePaypalOrder, captureVaultOrderRest, isPaypalConfigured, type VaultCaptureResult } from "@/lib/paypal";
import { loadPayInfo } from "@/lib/payInfo";
import { recordPaypalPayment } from "@/lib/paypalRecord";

/* PUBLIC (middleware-exempt). Captures an approved order and records the
   payment. Money only moves on capture; we record only when COMPLETED.
   Recording is idempotent (paypal_capture_id), so the webhook can't double it. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isPaypalConfigured()) {
    return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
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

  // if we're arming autopay, capture via REST so we can read + store the vault id
  const { data: ev } = await supabase
    .from("events")
    .select("autopay_enabled, autopay_vault_id")
    .eq("id", info.eventId)
    .maybeSingle();
  const arming = ev?.autopay_enabled === true && !ev?.autopay_vault_id;

  const result = arming ? await captureVaultOrderRest(orderId) : await capturePaypalOrder(orderId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  const { capture } = result;
  if (!capture.completed || !capture.captureId || capture.amount == null) {
    return NextResponse.json({ error: "Payment was not completed." }, { status: 402 });
  }

  // store the vaulted method so the autopay cron can charge future payments
  if (arming) {
    const vc = capture as VaultCaptureResult;
    if (vc.vaultId) {
      await supabase
        .from("events")
        .update({
          autopay_vault_id: vc.vaultId,
          autopay_customer_id: vc.customerId ?? null,
          autopay_armed_at: new Date().toISOString(),
        })
        .eq("id", info.eventId);
    }
  }

  // the captured amount includes the convenience fee — split it back out so the
  // balance drops by the base and the fee is tracked separately
  const feePct = info.settings.paypalFeePct;
  const base = Math.round((capture.amount / (1 + feePct / 100)) * 100) / 100;
  const fee = Math.round((capture.amount - base) * 100) / 100;

  await recordPaypalPayment(supabase, {
    eventId: info.eventId,
    amount: base,
    processingFee: fee,
    captureId: capture.captureId,
    payerEmail: capture.payerEmail,
  });

  return NextResponse.json({ ok: true, amount: base, fee, charged: capture.amount });
}
