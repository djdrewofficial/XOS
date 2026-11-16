/* Shared payment / "today" date formatting for receipt merge tags and the
   Payments Received smart block. Mirrors the SQL rules in migration 00229:
   - Date-only values stored as midnight UTC keep that calendar date (no TZ shift)
   - Other timestamps format the America/New_York calendar date
   - "Today" for <current_date> is America/New_York */

const NY = "America/New_York";

function parseInstant(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** True when the instant is exactly midnight UTC (DJEP-style date-only payments). */
export function isMidnightUtc(iso: string): boolean {
  const d = parseInstant(iso);
  if (!d) return false;
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function longDateUtc(d: Date): string {
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function longDateNy(d: Date): string {
  return d.toLocaleDateString("en-US", {
    timeZone: NY,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a payment paid_at for client-facing copy. */
export function formatPaymentDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseInstant(iso);
  if (!d) return "";
  return isMidnightUtc(iso) ? longDateUtc(d) : longDateNy(d);
}

/** America/New_York "today" as a long date (for <current_date>). */
export function formatCurrentDateNy(now: Date = new Date()): string {
  return longDateNy(now);
}
