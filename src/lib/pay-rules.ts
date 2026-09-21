// Pay-month arithmetic and paid-day counting. Pure, and every rule value comes in as an argument read from
// settings (the pay month's start day, which days are off) — see pay-engine.ts for the per-day pay rules.

import { addDays } from "@/lib/today";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The days of the pay month named `year`/`month`, inclusive. With a start day of 26 it runs from the 26th of
 * the month before to the 25th; with a start day of 1 it is simply the calendar month.
 */
export function payPeriodRange(year: number, month: number, startDay: number): { from: string; to: string } {
  if (startDay <= 1) {
    const from = `${year}-${pad(month)}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
    return { from, to: addDays(next, -1) };
  }
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return { from: `${prevYear}-${pad(prevMonth)}-${pad(startDay)}`, to: addDays(`${year}-${pad(month)}-${pad(startDay)}`, -1) };
}

/** The pay month a calendar day belongs to: from the start day on, it is already next month's. */
export function payPeriodOf(day: string, startDay: number): { year: number; month: number } {
  const [y, m, d] = day.split("-").map(Number);
  if (startDay <= 1 || d < startDay) return { year: y, month: m };
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

/** Pay day for the pay month named `year`/`month`: the 1st of the following month. */
export function payday(year: number, month: number): string {
  return month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
}

/** Statuses of a day a daily worker is paid for as worked. A single punch still counts (HR reviews it). */
const WORKED_STATUSES = ["present", "late", "early_leave", "missing_punch", "mission"];
/** Days off whose cost is carried by an absence deduction instead of by leaving the day unpaid. */
const CHARGED_OFF_STATUSES = ["absent", "leave", "excused_absence"];

/**
 * The days a daily worker is paid at the day rate. Worked days, plus — from the day absences are tracked on —
 * days off, because those are charged through the absence deduction and leaving them unpaid as well would
 * charge them twice (forgiving an absence, by removing its deduction, therefore pays the day). Work on the
 * weekly day off or a public holiday is not a day's pay: it is paid by the hour at that day's multiplier.
 */
export function dailyPaidDays(
  days: { date: string; status: string }[],
  trackedFrom: string,
  isOffDay: (date: string) => boolean = () => false,
): number {
  return days.filter(
    (d) =>
      !isOffDay(d.date) &&
      (WORKED_STATUSES.includes(d.status) || (CHARGED_OFF_STATUSES.includes(d.status) && d.date >= trackedFrom)),
  ).length;
}
