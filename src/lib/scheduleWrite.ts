import type { SupabaseClient } from "@supabase/supabase-js";
import { buildScheduleRows, type SchedulePlan } from "@/lib/paymentSchedule";
import { splitSchedule, type SchedRow } from "@/lib/scheduleLock";

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
 * already-covered installment. Coverage nets ACTUAL approved payment amounts
 * from the payments table (not only rows with scheduled_payment_id) against
 * schedule rows in seq order via splitSchedule. Manual / unlinked payments
 * still lock earlier installments. Locked rows stay put; only the open tail is
 * (re)generated to cover the remaining balance.
 */
export async function writeSchedulePreservingPaid(
  supabase: SupabaseClient,
  eventId: string,
  params: ScheduleParams,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: existing }, { data: approved }] = await Promise.all([
    supabase.from("scheduled_payments").select("id, seq, amount, due_date, label").eq("event_id", eventId).order("seq"),
    supabase
      .from("payments")
      .select("amount, scheduled_payment_id")
      .eq("event_id", eventId)
      .eq("status", "approved")
      .is("deleted_at", null),
  ]);

  const rowsAll = (existing ?? []) as SchedRow[];
  const approvedRefs = ((approved ?? []) as { amount: number; scheduled_payment_id: string | null }[]).map((p) => ({
    amount: Number(p.amount || 0),
    scheduled_payment_id: p.scheduled_payment_id,
  }));
  const { locked, open, lockedSum, received } = splitSchedule(rowsAll, approvedRefs, "seq");
  // Prefer cash received when it exceeds locked installment totals (partial into next row).
  const covered = Math.max(lockedSum, received);

  // Only clear UNPAID installments — covered ones stay put (and keep any payment links).
  const unpaidIds = open.map((r) => r.id);
  if (unpaidIds.length) {
    const { error } = await supabase.from("scheduled_payments").delete().in("id", unpaidIds);
    if (error) throw new Error(error.message);
  }

  let newRows: { seq: number; amount: number; label: string; due_date: string | null }[];
  if (locked.length === 0 && received <= 0) {
    newRows = buildScheduleRows({ ...params, today });
  } else {
    const remaining = round2(params.total - covered);
    if (remaining <= 0) {
      newRows = []; // already fully covered by payments received
    } else {
      const maxPaidSeq = locked.reduce((m, r) => Math.max(m, r.seq), 0);
      // Re-split only the remaining balance: treat covered cash as the
      // "deposit" so the generated payment rows sum to `remaining`, then drop
      // that synthetic deposit row and renumber the tail after the paid prefix.
      const splitPlan: SchedulePlan = params.plan.kind === "split" ? params.plan : { kind: "split", count: 1 };
      const gen = buildScheduleRows({
        total: params.total,
        deposit: covered,
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
