// Calendar days are "yyyy-MM-dd" strings in the factory's local time (the server runs on Egypt time).
// Never turn a local-midnight Date into a day with toISOString(): that reads it in UTC, and in
// Egypt (UTC+2/+3) local midnight is still the previous day in UTC — every such day comes out one
// day early.

/** The calendar day a moment falls on, in local time. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The current date as yyyy-MM-dd (local time). */
export function today(): string {
  return localDay(new Date());
}

/** A calendar day `delta` days from `day` — pure date arithmetic, no time zone involved. */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Current year + 1-based month, for "this month" (payroll / monthly KPIs). */
export function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
