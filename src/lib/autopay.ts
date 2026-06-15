import type { SupabaseClient } from "@supabase/supabase-js";
import { chargeVaultedPayment } from "@/lib/paypal";
import { recordPaypalPayment } from "@/lib/paypalRecord";
import { withFee } from "@/lib/payInfo";

/* Daily autopay run: for each event with a vaulted method, charge the earliest
   due, still-unpaid scheduled payment (one per event per run — overdue ones
   catch up on subsequent runs). Recording is idempotent on the capture id, and
   a failing method is retried at most MAX_ATTEMPTS times before we stop + alert. */

const MAX_ATTEMPTS = 3;
const round2 = (n: number) => Math.round(n * 100) / 100;

type Summary = { charged: number; failed: number; events: number };

export async function runAutopayCharges(supabase: SupabaseClient): Promise<Summary> {
  const today = new Date().toISOString().slice(0, 10);
  const summary: Summary = { charged: 0, failed: 0, events: 0 };

  const { data: events } = await supabase
    .from("events")
    .select("id, name, autopay_vault_id")
    .eq("autopay_enabled", true)
    .not("autopay_vault_id", "is", null);

  const { data: pset } = await supabase.from("payment_settings").select("paypal_fee_pct").eq("id", true).maybeSingle();
  const feePct = Number((pset as { paypal_fee_pct?: number } | null)?.paypal_fee_pct ?? 4);

  for (const ev of events ?? []) {
    summary.events++;
    const vaultId = ev.autopay_vault_id as string;

    const [{ data: scheduled }, { data: payments }] = await Promise.all([
      supabase
        .from("scheduled_payments")
        .select("id, seq, amount, due_date, autopay_attempts")
        .eq("event_id", ev.id)
        .order("seq"),
      supabase.from("payments").select("scheduled_payment_id").eq("event_id", ev.id),
    ]);

    const taken = new Set((payments ?? []).map((p) => p.scheduled_payment_id).filter(Boolean));
    const due = (scheduled ?? []).find(
      (s) =>
        !taken.has(s.id) &&
        s.due_date &&
        s.due_date <= today &&
        (s.autopay_attempts ?? 0) < MAX_ATTEMPTS &&
        Number(s.amount) > 0
    );
    if (!due) continue;

    const base = round2(Number(due.amount));
    const charge = withFee(base, feePct);

    const res = await chargeVaultedPayment(charge, vaultId, {
      customId: ev.id,
      description: `Auto-payment for ${ev.name ?? "your event"}`,
      idempotencyKey: `autopay-${due.id}`,
    });

    if (res.ok && res.capture.completed && res.capture.captureId && res.capture.amount != null) {
      const capBase = round2(res.capture.amount / (1 + feePct / 100));
      const fee = round2(res.capture.amount - capBase);
      await recordPaypalPayment(supabase, {
        eventId: ev.id as string,
        amount: capBase,
        processingFee: fee,
        captureId: res.capture.captureId,
        payerEmail: null,
      });
      summary.charged++;
    } else {
      const err = (res.ok ? "Charge did not complete" : res.error).slice(0, 300);
      await supabase
        .from("scheduled_payments")
        .update({
          autopay_attempts: (due.autopay_attempts ?? 0) + 1,
          autopay_last_attempt_at: new Date().toISOString(),
          autopay_last_error: err,
        })
        .eq("id", due.id);
      await supabase.rpc("create_notification", {
        p_type: "payment",
        p_title: `Autopay failed: ${ev.name ?? "event"}`,
        p_body: `Could not charge ${charge.toFixed(2)} (attempt ${(due.autopay_attempts ?? 0) + 1}/${MAX_ATTEMPTS}). ${err}`,
        p_href: `/events/${ev.id}`,
      });
      summary.failed++;
    }
  }

  return summary;
}
