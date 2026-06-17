import type { SupabaseClient } from "@supabase/supabase-js";
import { processOutbox } from "@/lib/mailgun";
import { signingEmailHtml, appUrl } from "@/lib/signing";
import { runAutomations } from "@/lib/automations";

/* Records a completed PayPal capture into the payments table — idempotent on
   paypal_capture_id, so the capture endpoint and the webhook can both call it
   and the payment lands exactly once. Links to the earliest still-unpaid
   scheduled payment and emails the client a receipt. */
export async function recordPaypalPayment(
  supabase: SupabaseClient,
  params: { eventId: string; amount: number; captureId: string; payerEmail: string | null; payerName?: string | null; processingFee?: number }
): Promise<{ recorded: boolean; duplicate?: boolean }> {
  // already recorded? (capture endpoint or webhook beat us here)
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("paypal_capture_id", params.captureId)
    .maybeSingle();
  if (existing) return { recorded: false, duplicate: true };

  const { data: ev } = await supabase
    .from("events")
    .select("id, client_id, name, client:clients(first_name, email)")
    .eq("id", params.eventId)
    .maybeSingle();

  // link to the earliest scheduled payment that has no payment against it yet
  const [{ data: scheduled }, { data: priorPayments }] = await Promise.all([
    supabase.from("scheduled_payments").select("id, seq").eq("event_id", params.eventId).order("seq"),
    supabase.from("payments").select("scheduled_payment_id").eq("event_id", params.eventId).eq("status", "approved"),
  ]);
  const taken = new Set((priorPayments ?? []).map((p) => p.scheduled_payment_id).filter(Boolean));
  const scheduledId = (scheduled ?? []).find((s) => !taken.has(s.id))?.id ?? null;

  const { error } = await supabase.from("payments").insert({
    event_id: params.eventId,
    scheduled_payment_id: scheduledId,
    amount: params.amount,
    processing_fee: params.processingFee ?? 0,
    method: "paypal",
    status: "approved",
    paypal_capture_id: params.captureId,
    payer_name: params.payerName ?? null,
    notes: params.payerEmail
      ? `PayPal · ${params.payerEmail}${params.processingFee ? ` · +${params.processingFee.toFixed(2)} fee` : ""}`
      : "PayPal",
  });
  // a concurrent insert may win the unique index — treat as already-recorded
  if (error) {
    if (error.code === "23505") return { recorded: false, duplicate: true };
    throw new Error(error.message);
  }

  // receipt email to the client
  const client = ev?.client as { first_name?: string; email?: string } | null;
  if (client?.email) {
    const { data: cs } = await supabase
      .from("company_settings")
      .select("company_name, from_name, from_email, reply_to")
      .eq("id", true)
      .maybeSingle();
    const companyName = cs?.company_name ?? "Xpress Entertainment";
    const first = client.first_name ?? "there";
    const amt = params.amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
    await supabase.from("email_log").insert({
      event_id: params.eventId,
      to_address: client.email,
      from_name: cs?.from_name ?? companyName,
      from_address: cs?.from_email ?? null,
      reply_to: cs?.reply_to ?? null,
      subject: `Payment received — thank you, ${first}!`,
      body_html: signingEmailHtml({
        heading: "Payment received 🎉",
        bodyHtml: `<p>Thank you, ${first}! We've received your payment of <strong>${amt}</strong> for ${
          ev?.name ?? "your event"
        }.</p><p>This email is your receipt. We can't wait to celebrate with you!</p>`,
        buttonLabel: "View Your Event Balance",
        buttonUrl: `${appUrl()}/pay/${params.eventId}`,
        companyName,
      }),
    });
    await processOutbox(supabase);
  }

  // fire any "payment received" automations (welcome email, etc.)
  await runAutomations(supabase, params.eventId, "payment_received");

  return { recorded: true };
}
