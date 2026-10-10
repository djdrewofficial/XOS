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

/**
 * Parse a plan token from forms / selects.
 * Accepts: "full", "split:N", bare "N" (legacy split count), "net:N".
 * Empty / "0" / "none" → null (no schedule).
 */
export function parseSchedulePlan(raw: FormDataEntryValue | string | null | undefined): SchedulePlan | null {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (!s || s === "0" || s === "none" || s === "skip") return null;
  if (s === "full" || s === "up_front" || s === "paid_in_full") return { kind: "full" };
  if (s.startsWith("net:")) {
    const days = Math.max(1, Math.round(Number(s.slice(4)) || 30));
    return { kind: "net", days };
  }
  const countRaw = s.startsWith("split:") ? s.slice(6) : s;
  const count = Math.max(1, Math.round(Number(countRaw) || 0));
  if (!Number.isFinite(count) || count < 1) return null;
  return { kind: "split", count };
}

/** True when the event is within `days` days (inclusive) of today — soft staff hint only. */
export function eventWithinDays(eventDate: string | null | undefined, days: number, today?: string): boolean {
  if (!eventDate) return false;
  const t = today ?? new Date().toISOString().slice(0, 10);
  const start = new Date(t + "T12:00:00");
  const end = new Date(eventDate + "T12:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return diff >= 0 && diff <= days;
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

  // Full payment due: a single payment of the whole investment, due now.
  if (plan.kind === "full") {
    return [{ seq: 1, amount: round2(total), label: "Full Payment Due", due_date: today }];
  }

  // Net terms: a single invoice for the whole amount, due N days out.
  if (plan.kind === "net") {
    const d = new Date(today);
    d.setDate(d.getDate() + plan.days);
    return [{ seq: 1, amount: round2(total), label: `Net ${plan.days}`, due_date: iso(d) }];
  }

  const count = Math.max(1, Math.round(plan.count));
  // Clamp the deposit to [0, total] so the schedule always sums to the total: a
  // deposit larger than the total would otherwise show the full deposit while the
  // remaining splits floor at $0, over-summing the schedule.
  const dep = Math.max(0, Math.min(deposit, total));
  const rows: ScheduleRow[] = [
    { seq: 1, amount: round2(dep), label: "Deposit", due_date: today },
  ];

  // final payment lands on the package's due date; earlier ones step back monthly
  let finalDue: Date | null = null;
  if (eventDate) {
    finalDue = new Date(eventDate);
    if (terms === "days_before") finalDue.setDate(finalDue.getDate() - termsDays);
    else finalDue.setDate(finalDue.getDate() + termsDays);
  }

  const remaining = Math.max(0, total - dep);
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
