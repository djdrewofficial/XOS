// Which installments of an event's payment schedule are already paid ("locked")
// and may not be edited when the event total changes.
//
// Coverage nets ACTUAL approved payment amounts from the payments table against
// schedule rows (not only rows with a scheduled_payment_id link). Manual /
// DJEP-imported payments are often unlinked; their amount still covers the
// earliest due (or seq) installments. A row is also locked when a payment is
// explicitly linked to it.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SchedRow = { id: string; seq: number; amount: number; due_date: string | null; label: string | null };

export type ScheduleOrder = "seq" | "due_date";

export type ApprovedPaymentRef = { amount: number; scheduled_payment_id: string | null };

function sortScheduleRows(rows: SchedRow[], order: ScheduleOrder): SchedRow[] {
  if (order === "due_date") {
    return [...rows].sort((a, b) => {
      const da = a.due_date ? String(a.due_date).slice(0, 10) : "9999-99-99";
      const db = b.due_date ? String(b.due_date).slice(0, 10) : "9999-99-99";
      if (da !== db) return da.localeCompare(db);
      return a.seq - b.seq;
    });
  }
  return [...rows].sort((a, b) => a.seq - b.seq);
}

/** Total approved cash received (linked or unlinked). */
export function totalApprovedPayments(approved: ApprovedPaymentRef[]): number {
  return round2(approved.reduce((s, p) => s + Number(p.amount || 0), 0));
}

/**
 * Split schedule into locked (covered) vs open (still due).
 * order "seq" = staff schedule editor / payments_save_schedule (prefix by seq).
 * order "due_date" = client-facing upcoming payments (apply cash by due date).
 */
export function splitSchedule(
  rows: SchedRow[],
  approved: ApprovedPaymentRef[],
  order: ScheduleOrder = "seq",
): { locked: SchedRow[]; open: SchedRow[]; lockedSum: number; received: number } {
  const linked = new Set(approved.map((p) => p.scheduled_payment_id).filter(Boolean) as string[]);
  const received = totalApprovedPayments(approved);
  const sorted = sortScheduleRows(rows, order);
  const locked: SchedRow[] = [];
  const open: SchedRow[] = [];
  let cumulative = 0;
  for (const r of sorted) {
    cumulative += Number(r.amount);
    if (linked.has(r.id) || cumulative <= received + 0.005) locked.push(r);
    else open.push(r);
  }
  return {
    locked,
    open,
    lockedSum: round2(locked.reduce((s, r) => s + Number(r.amount), 0)),
    received,
  };
}

/** Open / upcoming rows for client docs: apply actual payments in due-date order. */
export function unpaidScheduleRows(rows: SchedRow[], approved: ApprovedPaymentRef[]): SchedRow[] {
  return splitSchedule(rows, approved, "due_date").open;
}
