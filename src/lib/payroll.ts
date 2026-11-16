/* Payroll math: payable hours, staff cost, and pay-period math. */

import {
  effectiveHourlyRate,
  hoursFromPunches,
  hourlyAmount,
  payableHoursFromPunches,
  type PunchLite,
  type TimeClockSettingsLite,
} from "@/lib/timeClock";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type StaffLite = {
  start_time?: string | null;
  end_time?: string | null;
  pay_type?: string | null;
  flat_wage?: number | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  hourly_rate_override?: number | null;
  timesheet_rate?: number | null;
  timesheet_hours?: number | null;
  timesheet_amount?: number | null;
  timesheet_status?: string | null;
};
export type EventTimes = { setup_time?: string | null; start_time?: string | null; end_time?: string | null };

function toMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

/* Payable hours for a staffer.
   - With punches: sum of in→out pairs; travel added only when
     time_clock_settings.include_travel_for_hourly_punches is on (default off).
   - Without punches but actual check-in/out stamps: clocked span; same travel rule
     when opts.punchedHourly is true.
   - Estimate (no punches): scheduled window + round-trip venue travel (flat/estimate). */
export function staffHours(
  es: StaffLite,
  event: EventTimes,
  travelMinutes: number | null | undefined,
  opts: {
    actual?: boolean;
    punches?: PunchLite[];
    settings?: TimeClockSettingsLite | null;
    punchedHourly?: boolean;
  } = {}
): number {
  if (opts.punches && opts.punches.length) {
    return payableHoursFromPunches(opts.punches, opts.settings, travelMinutes);
  }

  const travelH = 2 * ((travelMinutes ?? 0) / 60);
  const skipTravel = opts.punchedHourly && !opts.settings?.include_travel_for_hourly_punches;

  if (opts.actual && es.checked_in_at && es.checked_out_at) {
    const ms = new Date(es.checked_out_at).getTime() - new Date(es.checked_in_at).getTime();
    const clocked = ms > 0 ? ms / 3_600_000 : 0;
    return round2(clocked + (skipTravel ? 0 : travelH));
  }

  const startMin = toMinutes(es.start_time) ?? toMinutes(event.setup_time) ?? toMinutes(event.start_time);
  const endMin = toMinutes(es.end_time) ?? toMinutes(event.end_time);
  if (startMin == null || endMin == null || endMin <= startMin) return round2(travelH);
  return round2((endMin - startMin) / 60 + travelH);
}

/* What a staffer is owed for an event: flat fee, or hours × effective hourly rate. */
export function staffCost(
  es: StaffLite,
  employee: { hourly_rate?: number | null } | null,
  hours: number
): number {
  if ((es.pay_type ?? "flat") === "flat") return Number(es.flat_wage) || 0;
  if (es.timesheet_amount != null && Number.isFinite(Number(es.timesheet_amount))) {
    return Number(es.timesheet_amount);
  }
  const rate = effectiveHourlyRate(es, employee);
  return hourlyAmount(hours, rate);
}

/** Prefer locked/approved timesheet totals when present. */
export function staffCostForPayroll(
  es: StaffLite,
  employee: { hourly_rate?: number | null } | null,
  hours: number
): number | null {
  const payType = es.pay_type ?? "flat";
  if (payType === "hourly") {
    const status = es.timesheet_status ?? "open";
    if (status !== "approved" && status !== "locked" && status !== "paid") return null;
    if (es.timesheet_amount != null) return Number(es.timesheet_amount);
    const h = es.timesheet_hours != null ? Number(es.timesheet_hours) : hours;
    return staffCost(es, employee, h);
  }
  return staffCost(es, employee, hours);
}

export function rawPunchHours(punches: PunchLite[]): number {
  return hoursFromPunches(punches);
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
