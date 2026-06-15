// Pure payment-schedule math — shared by the office-side editor
// (addScheduledPayments) and the client-facing /proposal plan selector so the
// preview a couple sees matches exactly what gets stored. No server imports:
// safe to use from client components.

export type SchedulePlan =
  | { kind: "full" }
  | { kind: "split"; count: number }
  | { kind: "net"; days: number };

export type ScheduleRow = {
  seq: number;
  amount: number;
  label: string;
  due_date: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ISO yyyy-mm-dd for a Date (local). */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildScheduleRows(opts: {
  total: number;
  deposit: number;
  eventDate: string | null;
  terms: "days_before" | "net_days_after";
  termsDays: number;
  plan: SchedulePlan;
  /** "today" as yyyy-mm-dd — pass new Date().toISOString().slice(0,10) */
  today: string;
}): ScheduleRow[] {
  const { total, deposit, eventDate, terms, termsDays, plan, today } = opts;

  // Pay in full: a single payment of the whole investment, due now.
  if (plan.kind === "full") {
    return [{ seq: 1, amount: round2(total), label: "Paid in Full", due_date: today }];
  }

  // Net terms: a single invoice for the whole amount, due N days out.
  if (plan.kind === "net") {
    const d = new Date(today);
    d.setDate(d.getDate() + plan.days);
    return [{ seq: 1, amount: round2(total), label: `Net ${plan.days}`, due_date: iso(d) }];
  }

  const count = Math.max(1, Math.round(plan.count));
  const rows: ScheduleRow[] = [
    { seq: 1, amount: round2(deposit), label: "Deposit", due_date: today },
  ];

  // final payment lands on the package's due date; earlier ones step back monthly
  let finalDue: Date | null = null;
  if (eventDate) {
    finalDue = new Date(eventDate);
    if (terms === "days_before") finalDue.setDate(finalDue.getDate() - termsDays);
    else finalDue.setDate(finalDue.getDate() + termsDays);
  }

  const remaining = Math.max(0, total - deposit);
  const per = Math.floor((remaining / count) * 100) / 100;
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const amount = isLast ? round2(remaining - per * (count - 1)) : per;
    let due: string | null = null;
    if (finalDue) {
      const d = new Date(finalDue);
      d.setMonth(d.getMonth() - (count - 1 - i));
      due = iso(d);
    }
    rows.push({
      seq: i + 2,
      amount,
      label: count === 1 ? "Final Payment" : `Payment ${i + 2}`,
      due_date: due,
    });
  }
  return rows;
}
