import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPaypalWebhook } from "@/lib/paypal";
import { recordPaypalPayment } from "@/lib/paypalRecord";

/* PUBLIC (middleware-exempt). Reliability backstop for the capture endpoint —
   if a client closes the tab after approving but before our capture call
   returns, PayPal's PAYMENT.CAPTURE.COMPLETED webhook still records the payment.
   Idempotent on paypal_capture_id. Verified via PAYPAL_WEBHOOK_ID; if that's
   not set yet the event is ignored (never trust an unverified hook). */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const verified = await verifyPaypalWebhook(req.headers, raw);
  if (!verified) {
    // not configured yet, or signature failed — acknowledge so PayPal stops
    // retrying, but do nothing
    return NextResponse.json({ ignored: true });
  }

  let event: { event_type?: string; resource?: Record<string, unknown> } = {};
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ignored: true });
  }

  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
    return NextResponse.json({ ok: true, skipped: event.event_type });
  }

  const resource = event.resource ?? {};
  const captureId = (resource.id as string) ?? null;
  const eventId = (resource.custom_id as string) ?? null;
  const amountObj = resource.amount as { value?: string } | undefined;
  const amount = amountObj?.value ? Number(amountObj.value) : null;
  if (!captureId || !eventId || amount == null) {
    return NextResponse.json({ ok: true, skipped: "missing fields" });
  }

  const payer = (resource.payer as { email_address?: string } | undefined) ?? undefined;
  const supabase = createAdminClient();
  await recordPaypalPayment(supabase, {
    eventId,
    amount,
    captureId,
    payerEmail: payer?.email_address ?? null,
  });

  return NextResponse.json({ ok: true });
}
