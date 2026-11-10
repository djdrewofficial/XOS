import type { SupabaseClient } from "@supabase/supabase-js";
import { runAutomations } from "@/lib/automations";
import { loadEventBundle } from "@/lib/documentRender";
import { buildScheduleRows, parseSchedulePlan, type SchedulePlan } from "@/lib/paymentSchedule";
import { splitSchedule, type SchedRow } from "@/lib/scheduleLock";
import { writeSchedulePreservingPaid } from "@/lib/scheduleWrite";

export function assertPaymentAmount(amount: number) {
  if (!(amount > 0)) throw new Error("Enter a payment amount greater than $0.");
}

/** Record a received payment and run payment_received automations. Same path as
    the Financials tab. Automations may queue client mail; the caller sends it
    by running the outbox (the staff action does that inside runAutomations). */
export async function recordPayment(
  supabase: SupabaseClient,
  input: { eventId: string; amount: number; method: string; reason: string | null; paidAt: string | null; notes: string | null },
  opts: { drain?: "all" | "event" } = {},
) {
  assertPaymentAmount(input.amount);
  const { error } = await supabase.from("payments").insert({
    event_id: input.eventId,
    amount: input.amount,
    method: input.method || "other",
    reason: input.reason,
    paid_at: input.paidAt ?? new Date().toISOString(),
    notes: input.notes,
  });
  if (error) throw new Error(error.message);
  await runAutomations(supabase, input.eventId, "payment_received", { drain: opts.drain ?? "all" });
}

export async function updatePaymentRecord(
  supabase: SupabaseClient,
  input: { paymentId: string; eventId: string; amount: number | null; method: string; reason: string | null; paidAt: string | null; notes: string | null },
) {
  const { data: existing } = await supabase
    .from("payments")
    .select("id, paypal_capture_id")
    .eq("id", input.paymentId)
    .eq("event_id", input.eventId)
    .maybeSingle();
  if (!existing) throw new Error("Payment not found.");
  const update: Record<string, unknown> = {
    method: input.method || "other",
    reason: input.reason,
    notes: input.notes,
  };
  if (input.paidAt) update.paid_at = input.paidAt;
  if (!existing.paypal_capture_id) {
    if (input.amount == null) throw new Error("Enter a payment amount greater than $0.");
    assertPaymentAmount(input.amount);
    update.amount = input.amount;
  }
  const { error } = await supabase.from("payments").update(update).eq("id", input.paymentId);
  if (error) throw new Error(error.message);
}

export async function confirmPaymentRecord(
  supabase: SupabaseClient,
  input: { paymentId: string; eventId: string; note: string | null },
  opts: { drain?: "all" | "event" } = {},
) {
  const { data: pending } = await supabase
    .from("payments")
    .select("amount")
    .eq("id", input.paymentId)
    .eq("event_id", input.eventId)
    .maybeSingle();
  if (!pending) throw new Error("Payment not found.");
  if (!(Number(pending.amount) > 0)) throw new Error("This payment's amount is invalid — remove it and re-enter.");

  const [{ data: scheduled }, { data: priorPayments }] = await Promise.all([
    supabase.from("scheduled_payments").select("id, seq").eq("event_id", input.eventId).order("seq"),
    supabase.from("payments").select("scheduled_payment_id").eq("event_id", input.eventId).eq("status", "approved").is("deleted_at", null),
  ]);
  const taken = new Set((priorPayments ?? []).map((p) => p.scheduled_payment_id).filter(Boolean));
  const scheduledId = (scheduled ?? []).find((s) => !taken.has(s.id))?.id ?? null;
  const patch: Record<string, unknown> = { status: "approved", scheduled_payment_id: scheduledId, paid_at: new Date().toISOString() };
  if (input.note) patch.notes = input.note;
  const { data: updated, error } = await supabase
    .from("payments")
    .update(patch)
    .eq("id", input.paymentId)
    .eq("event_id", input.eventId)
    .eq("status", "pending")
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!updated?.length) throw new Error("This payment is not a pending claim anymore. Nothing else was run.");
  await runAutomations(supabase, input.eventId, "payment_received", { drain: opts.drain ?? "all" });
}

export async function softRemovePayment(
  supabase: SupabaseClient,
  input: { paymentId: string; eventId: string; deletedBy: string },
) {
  const { error } = await supabase
    .from("payments")
    .update({ deleted_at: new Date().toISOString(), deleted_by: input.deletedBy })
    .eq("id", input.paymentId)
    .eq("event_id", input.eventId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
}

export async function restorePaymentRecord(supabase: SupabaseClient, input: { paymentId: string; eventId: string }) {
  const { error } = await supabase
    .from("payments")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", input.paymentId)
    .eq("event_id", input.eventId);
  if (error) throw new Error(error.message);
}

export async function saveRemainingScheduleRows(
  supabase: SupabaseClient,
  eventId: string,
  rows: { id: string | null; amount: number; due_date: string | null }[],
) {
  const [bundle, { data: sched }, { data: approved }] = await Promise.all([
    loadEventBundle(supabase, eventId),
    supabase.from("scheduled_payments").select("id, seq, amount, due_date, label").eq("event_id", eventId).order("seq"),
    supabase.from("payments").select("amount, scheduled_payment_id").eq("event_id", eventId).eq("status", "approved").is("deleted_at", null),
  ]);
  if (!bundle) throw new Error("Event not found.");
  const { locked, open, lockedSum } = splitSchedule((sched ?? []) as SchedRow[], (approved ?? []) as { amount: number; scheduled_payment_id: string | null }[]);
  const openIds = new Set(open.map((r) => r.id));
  const lockedIds = new Set(locked.map((r) => r.id));
  const keep = rows.map((r) => ({ ...r, amount: Math.round(Number(r.amount) * 100) / 100 })).filter((r) => r.amount > 0);
  if (keep.some((r) => r.id && lockedIds.has(r.id))) throw new Error("Paid installments can't be changed.");
  if (keep.some((r) => r.id && !openIds.has(r.id))) throw new Error("The schedule changed — refresh and try again.");
  const target = Math.round((bundle.total - lockedSum) * 100) / 100;
  const sum = Math.round(keep.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  if (Math.abs(sum - target) >= 0.01) {
    throw new Error(`Remaining payments add up to $${sum.toFixed(2)} — they need to total $${target.toFixed(2)}.`);
  }
  const keptIds = new Set(keep.map((r) => r.id).filter(Boolean) as string[]);
  const removed = open.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
  if (removed.length) {
    const { error } = await supabase.from("scheduled_payments").delete().in("id", removed);
    if (error) throw new Error(error.message);
  }
  let seq = locked.reduce((m, r) => Math.max(m, r.seq), 0);
  const sorted = [...keep].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  for (const [i, r] of sorted.entries()) {
    seq++;
    const label = i === sorted.length - 1 ? "Final Payment" : `Payment ${seq}`;
    const row = { seq, amount: r.amount, due_date: r.due_date || null, label };
    const { error } = r.id
      ? await supabase.from("scheduled_payments").update(row).eq("id", r.id)
      : await supabase.from("scheduled_payments").insert({ ...row, event_id: eventId });
    if (error) throw new Error(error.message);
  }
  await supabase.from("events").update({ schedule_ack_total: bundle.total }).eq("id", eventId);
}

export async function addScheduledPaymentPlan(
  supabase: SupabaseClient,
  input: { eventId: string; plan: SchedulePlan; total: number; deposit: number; eventDate: string | null },
) {
  if (input.plan.kind === "net") throw new Error("Pick Full payment due or a deposit + installment split.");
  const { data: event } = await supabase.from("events").select("package_id").eq("id", input.eventId).single();
  let terms: "days_before" | "net_days_after" = "days_before";
  let termsDays = 30;
  let allowedSplits: number[] = [1, 2, 3];
  if (event?.package_id) {
    const { data: pkg } = await supabase
      .from("packages")
      .select("payment_terms, payment_terms_days, allowed_splits")
      .eq("id", event.package_id)
      .single();
    if (pkg) {
      terms = (pkg.payment_terms as typeof terms) ?? "days_before";
      termsDays = pkg.payment_terms_days ?? 30;
      allowedSplits = pkg.allowed_splits?.length ? pkg.allowed_splits : [1, 2, 3];
    }
  }
  if (input.plan.kind === "split" && !allowedSplits.includes(input.plan.count)) {
    throw new Error(`This package allows ${allowedSplits.join(", ")} payment split(s) — ${input.plan.count} is not permitted.`);
  }
  await writeSchedulePreservingPaid(supabase, input.eventId, {
    total: input.total,
    deposit: input.deposit,
    eventDate: input.eventDate,
    terms,
    termsDays,
    plan: input.plan,
  });
}

export { parseSchedulePlan, buildScheduleRows };
