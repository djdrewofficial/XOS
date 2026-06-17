/* Payroll math: payable hours, staff cost, and pay-period math. */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type StaffLite = {
  start_time?: string | null;
  end_time?: string | null;
  pay_type?: string | null;
  flat_wage?: number | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
};
export type EventTimes = { setup_time?: string | null; start_time?: string | null; end_time?: string | null };

function toMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

/* Payable hours for a staffer. Estimate = (end − setup) using the staffer's own
   start/end when set, else event setup→end; plus round-trip venue travel. When
   {actual} and both check-in/out exist, use the clocked span instead of the
   scheduled window (travel still added). */
export function staffHours(
  es: StaffLite,
  event: EventTimes,
  travelMinutes: number | null | undefined,
  opts: { actual?: boolean } = {}
): number {
  const travelH = 2 * ((travelMinutes ?? 0) / 60);

  if (opts.actual && es.checked_in_at && es.checked_out_at) {
    const ms = new Date(es.checked_out_at).getTime() - new Date(es.checked_in_at).getTime();
    return round2((ms > 0 ? ms / 3_600_000 : 0) + travelH);
  }

  const startMin = toMinutes(es.start_time) ?? toMinutes(event.setup_time) ?? toMinutes(event.start_time);
  const endMin = toMinutes(es.end_time) ?? toMinutes(event.end_time);
  if (startMin == null || endMin == null || endMin <= startMin) return round2(travelH);
  return round2((endMin - startMin) / 60 + travelH);
}

/* What a staffer is owed for an event: flat fee, or hours × default hourly rate. */
export function staffCost(es: StaffLite, employee: { hourly_rate?: number | null } | null, hours: number): number {
  if ((es.pay_type ?? "flat") === "flat") return Number(es.flat_wage) || 0;
  return round2(hours * (Number(employee?.hourly_rate) || 0));
}

export type PayPeriod = {
  payday: string;
  periodStart: string;
  periodEnd: string;
  prevPayday: string;
  nextPayday: string;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

/* The pay period whose window (prevPayday, payday] contains refISO, given the
   anchor "first pay day" and cadence. Works for refs before the anchor too. */
export function payPeriodFor(anchor: string | null | undefined, frequency: string, refISO: string): PayPeriod | null {
  if (!anchor) return null;

  if (frequency === "monthly") {
    let payday = anchor;
    while (payday < refISO) payday = addMonths(payday, 1);
    while (addMonths(payday, -1) >= refISO) payday = addMonths(payday, -1);
    const prev = addMonths(payday, -1);
    return { payday, prevPayday: prev, nextPayday: addMonths(payday, 1), periodStart: addDays(prev, 1), periodEnd: payday };
  }

  const interval = frequency === "weekly" ? 7 : 14;
  let payday = anchor;
  while (payday < refISO) payday = addDays(payday, interval);
  while (addDays(payday, -interval) >= refISO) payday = addDays(payday, -interval);
  const prev = addDays(payday, -interval);
  return { payday, prevPayday: prev, nextPayday: addDays(payday, interval), periodStart: addDays(prev, 1), periodEnd: payday };
}

export function fmtPeriod(p: PayPeriod): string {
  const f = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${f(p.periodStart)} – ${f(p.periodEnd)}`;
}
