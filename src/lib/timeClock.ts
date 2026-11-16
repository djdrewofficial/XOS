/* Time-clock math: haversine distance, punch pairing → hours, effective rate,
   and pay for hourly assignments. Settings flags (rounding / OT / min hours /
   travel / breaks / geofence) are applied here so every rule stays editable. */

export type PunchLite = {
  punch_type: "in" | "out" | string;
  punched_at: string;
  deleted_at?: string | null;
};

export type TimeClockSettingsLite = {
  include_travel_for_hourly_punches?: boolean | null;
  apply_rounding?: boolean | null;
  rounding_minutes?: number | null;
  apply_overtime?: boolean | null;
  overtime_weekly_hours?: number | null;
  overtime_multiplier?: number | null;
  apply_min_hours?: boolean | null;
  min_hours?: number | null;
  enable_breaks?: boolean | null;
  geofence_enabled?: boolean | null;
  geofence_radius_m?: number | null;
  geofence_mode?: "off" | "warn" | "block" | string | null;
  allow_punch_without_location?: boolean | null;
  capture_distance?: boolean | null;
  require_approval_before_payroll?: boolean | null;
  admin_edit_requires_reason?: boolean | null;
  missed_punch_grace_minutes?: number | null;
  enabled?: boolean | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Earth-surface distance in meters (haversine). Null if either point missing. */
export function distanceMeters(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined
): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  if (![lat1, lng1, lat2, lng2].every((n) => Number.isFinite(Number(n)))) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLng = toRad(Number(lng2) - Number(lng1));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Pair consecutive in→out punches (skips deleted). Open trailing in is ignored for hours. */
export function punchPairs(punches: PunchLite[]): { inAt: string; outAt: string }[] {
  const rows = punches
    .filter((p) => !p.deleted_at)
    .slice()
    .sort((a, b) => a.punched_at.localeCompare(b.punched_at));
  const pairs: { inAt: string; outAt: string }[] = [];
  let open: string | null = null;
  for (const p of rows) {
    if (p.punch_type === "in") {
      if (open == null) open = p.punched_at;
    } else if (p.punch_type === "out" && open != null) {
      pairs.push({ inAt: open, outAt: p.punched_at });
      open = null;
    }
  }
  return pairs;
}

/** Raw clocked hours from punch pairs (no travel). */
export function hoursFromPunches(punches: PunchLite[]): number {
  let ms = 0;
  for (const p of punchPairs(punches)) {
    const d = new Date(p.outAt).getTime() - new Date(p.inAt).getTime();
    if (d > 0) ms += d;
  }
  return round4(ms / 3_600_000);
}

function roundHours(hours: number, minutes: number): number {
  if (!minutes || minutes <= 0) return hours;
  const step = minutes / 60;
  return round4(Math.round(hours / step) * step);
}

/** Apply editable settings on top of raw punch hours. Travel is opt-in (default off). */
export function payableHoursFromPunches(
  punches: PunchLite[],
  settings: TimeClockSettingsLite | null | undefined,
  travelMinutes: number | null | undefined = 0
): number {
  let hours = hoursFromPunches(punches);
  if (settings?.include_travel_for_hourly_punches) {
    hours = round4(hours + 2 * ((travelMinutes ?? 0) / 60));
  }
  if (settings?.apply_rounding) {
    hours = roundHours(hours, Number(settings.rounding_minutes) || 15);
  }
  if (settings?.apply_min_hours) {
    const min = Number(settings.min_hours) || 0;
    if (min > 0 && hours > 0 && hours < min) hours = min;
  }
  // Overtime multiplier is applied at amount time (weekly context), not here.
  // enable_breaks is reserved; punch types are only in/out today.
  void settings?.enable_breaks;
  void settings?.apply_overtime;
  return round4(hours);
}

export function effectiveHourlyRate(
  assignment: { hourly_rate_override?: number | null; timesheet_rate?: number | null },
  employee: { hourly_rate?: number | null } | null
): number {
  const override = assignment.hourly_rate_override;
  if (override != null && Number.isFinite(Number(override))) return Number(override);
  if (assignment.timesheet_rate != null && Number.isFinite(Number(assignment.timesheet_rate))) {
    return Number(assignment.timesheet_rate);
  }
  return Number(employee?.hourly_rate) || 0;
}

export function hourlyAmount(hours: number, rate: number): number {
  return round2(hours * rate);
}

/** Whether a self-punch without GPS is allowed under settings. */
export function canPunchWithoutLocation(settings: TimeClockSettingsLite | null | undefined): boolean {
  return settings?.allow_punch_without_location !== false;
}

/** Geofence decision for UI (distance is still stored either way). */
export function geofenceDecision(
  settings: TimeClockSettingsLite | null | undefined,
  distanceM: number | null
): { ok: boolean; block: boolean; warn: boolean } {
  if (!settings?.geofence_enabled || settings.geofence_mode === "off" || distanceM == null) {
    return { ok: true, block: false, warn: false };
  }
  const radius = Number(settings.geofence_radius_m) || 500;
  if (distanceM <= radius) return { ok: true, block: false, warn: false };
  if (settings.geofence_mode === "block") return { ok: false, block: true, warn: false };
  if (settings.geofence_mode === "warn") return { ok: true, block: false, warn: true };
  return { ok: true, block: false, warn: false };
}

/** Missed punch: event date today (or past), scheduled start + grace passed, no in punch. */
export function isMissedPunch(input: {
  eventDate: string | null | undefined;
  startTime: string | null | undefined; // HH:MM or HH:MM:SS
  graceMinutes: number;
  hasInPunch: boolean;
  now?: Date;
}): boolean {
  if (input.hasInPunch || !input.eventDate || !input.startTime) return false;
  const now = input.now ?? new Date();
  const [hh, mm] = input.startTime.split(":").map(Number);
  if (Number.isNaN(hh)) return false;
  const start = new Date(`${input.eventDate}T${String(hh).padStart(2, "0")}:${String(mm || 0).padStart(2, "0")}:00`);
  // Interpret scheduled local wall time as UTC-naive comparison against now in local —
  // call sites pass company-local ISO dates; use epoch compare with grace.
  const due = start.getTime() + (input.graceMinutes || 0) * 60_000;
  return now.getTime() > due;
}

export function nextPunchType(punches: PunchLite[]): "in" | "out" {
  const live = punches.filter((p) => !p.deleted_at).sort((a, b) => a.punched_at.localeCompare(b.punched_at));
  let open = false;
  for (const p of live) {
    if (p.punch_type === "in") open = true;
    else if (p.punch_type === "out") open = false;
  }
  return open ? "out" : "in";
}

export const DEFAULT_TIME_CLOCK_SETTINGS: Required<
  Pick<
    TimeClockSettingsLite,
    | "enabled"
    | "allow_punch_without_location"
    | "capture_distance"
    | "geofence_enabled"
    | "geofence_radius_m"
    | "geofence_mode"
    | "include_travel_for_hourly_punches"
    | "apply_rounding"
    | "rounding_minutes"
    | "apply_overtime"
    | "overtime_weekly_hours"
    | "overtime_multiplier"
    | "apply_min_hours"
    | "min_hours"
    | "enable_breaks"
    | "require_approval_before_payroll"
    | "missed_punch_grace_minutes"
  >
> = {
  enabled: true,
  allow_punch_without_location: true,
  capture_distance: true,
  geofence_enabled: false,
  geofence_radius_m: 500,
  geofence_mode: "off",
  include_travel_for_hourly_punches: false,
  apply_rounding: false,
  rounding_minutes: 15,
  apply_overtime: false,
  overtime_weekly_hours: 40,
  overtime_multiplier: 1.5,
  apply_min_hours: false,
  min_hours: 0,
  enable_breaks: false,
  require_approval_before_payroll: true,
  missed_punch_grace_minutes: 30,
};
