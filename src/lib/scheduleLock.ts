// Which installments of an event's payment schedule are already paid ("locked")
// and may not be edited when the event total changes. An installment is locked
// when a payment is linked to it (online/confirmed payments) OR when the money
// received so far already covers it, oldest first (manual payments aren't
// linked to an installment).

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SchedRow = { id: string; seq: number; amount: number; due_date: string | null; label: string | null };

export function splitSchedule(
  rows: SchedRow[],
  approved: { amount: number; scheduled_payment_id: string | null }[],
): { locked: SchedRow[]; open: SchedRow[]; lockedSum: number } {
  const linked = new Set(approved.map((p) => p.scheduled_payment_id).filter(Boolean) as string[]);
  const received = approved.reduce((s, p) => s + Number(p.amount), 0);
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const locked: SchedRow[] = [];
  const open: SchedRow[] = [];
  let cumulative = 0;
  for (const r of sorted) {
    cumulative += Number(r.amount);
    if (linked.has(r.id) || cumulative <= received + 0.005) locked.push(r);
    else open.push(r);
  }
  return { locked, open, lockedSum: round2(locked.reduce((s, r) => s + Number(r.amount), 0)) };
}
