// US holidays relevant to an events business. Computed per year, no deps.

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  // month 0-11, weekday 0=Sun, n 1-based
  const first = new Date(Date.UTC(year, month, 1));
  let day = 1 + ((7 + weekday - first.getUTCDay()) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const day = last.getUTCDate() - ((7 + last.getUTCDay() - weekday) % 7);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function fixed(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function holidaysForYear(year: number): Map<string, string> {
  const h = new Map<string, string>();
  h.set(fixed(year, 0, 1), "New Year's Day");
  h.set(nthWeekday(year, 0, 1, 3), "MLK Day");
  h.set(fixed(year, 1, 14), "Valentine's Day");
  h.set(nthWeekday(year, 1, 1, 3), "Presidents' Day");
  h.set(nthWeekday(year, 4, 0, 2), "Mother's Day");
  h.set(lastWeekday(year, 4, 1), "Memorial Day");
  h.set(fixed(year, 5, 14), "Flag Day");
  h.set(nthWeekday(year, 5, 0, 3), "Father's Day");
  h.set(fixed(year, 5, 19), "Juneteenth");
  h.set(fixed(year, 6, 4), "Independence Day");
  h.set(nthWeekday(year, 8, 1, 1), "Labor Day");
  h.set(fixed(year, 9, 31), "Halloween");
  h.set(fixed(year, 10, 11), "Veterans Day");
  h.set(nthWeekday(year, 10, 4, 4), "Thanksgiving");
  h.set(fixed(year, 11, 24), "Christmas Eve");
  h.set(fixed(year, 11, 25), "Christmas Day");
  h.set(fixed(year, 11, 31), "New Year's Eve");
  return h;
}
