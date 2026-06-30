import type { SupabaseClient } from "@supabase/supabase-js";
import { buildScheduleRows, type SchedulePlan } from "@/lib/paymentSchedule";

const round2 = (n: number) => Math.round(n * 100) / 100;

type ScheduleParams = {
  total: number;
  deposit: number;
  eventDate: string | null;
  terms: "days_before" | "net_days_after";
  termsDays: number;
  plan: SchedulePlan;
};

/**
 * Write an event's payment schedule WITHOUT ever modifying or deleting an
 * already-paid installment. Payments link to the earliest unpaid installment
 * first, so paid installments are always a prefix (seq 1..k); we keep those rows
 * (and their payment links) untouched and only (re)generate the unpaid tail to
 * cover the remaining balance. When nothing is paid yet, this is a normal full
 * rebuild — identical to the old behavior.
 */
export async function writeSchedulePreservingPaid(
  supabase: SupabaseClient,
  eventId: string,
  params: ScheduleParams,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: existing }, { data: approved }] = await Promise.all([
    supabase.from("scheduled_payments").select("id, seq, amount").eq("event_id", eventId).order("seq"),
    supabase.from("payments").select("scheduled_payment_id").eq("event_id", eventId).eq("status", "approved"),
  ]);

  const paidIds = new Set(
    (approved ?? []).map((p) => (p as { scheduled_payment_id: string | null }).scheduled_payment_id).filter(Boolean) as string[],
  );
  const rowsAll = (existing ?? []) as { id: string; seq: number; amount: number }[];
  const paidRows = rowsAll.filter((r) => paidIds.has(r.id));
  const paidSum = round2(paidRows.reduce((s, r) => s + Number(r.amount), 0));
  const maxPaidSeq = paidRows.reduce((m, r) => Math.max(m, r.seq), 0);

  // Only clear UNPAID installments — paid ones (and their payment links) stay put.
  const unpaidIds = rowsAll.filter((r) => !paidIds.has(r.id)).map((r) => r.id);
  if (unpaidIds.length) {
    const { error } = await supabase.from("scheduled_payments").delete().in("id", unpaidIds);
    if (error) throw new Error(error.message);
  }

  let newRows: { seq: number; amount: number; label: string; due_date: string | null }[];
  if (paidRows.length === 0) {
    newRows = buildScheduleRows({ ...params, today });
  } else {
    const remaining = round2(params.total - paidSum);
    if (remaining <= 0) {
      newRows = []; // already fully covered by paid installments
    } else {
      // Re-split only the remaining balance: treat the paid amount as the
      // "deposit" so the generated payment rows sum to `remaining`, then drop
      // that synthetic deposit row and renumber the tail after the paid prefix.
      const splitPlan: SchedulePlan = params.plan.kind === "split" ? params.plan : { kind: "split", count: 1 };
      const gen = buildScheduleRows({
        total: params.total,
        deposit: paidSum,
        eventDate: params.eventDate,
        terms: params.terms,
        termsDays: params.termsDays,
        plan: splitPlan,
        today,
      });
      const tail = gen.slice(1);
      newRows = tail.map((r, i) => ({
        seq: maxPaidSeq + 1 + i,
        amount: r.amount,
        label: tail.length === 1 ? "Final Payment" : `Payment ${maxPaidSeq + 1 + i}`,
        due_date: r.due_date,
      }));
    }
  }

  if (newRows.length) {
    const { error } = await supabase
      .from("scheduled_payments")
      .insert(newRows.map((r) => ({ ...r, event_id: eventId })));
    if (error) throw new Error(error.message);
  }
}
