// The department report's periods. Client-safe (the period buttons import it): no database, no Node built-ins.

import { payPeriodOf, payPeriodRange } from "@/lib/pay-rules";
import { addDays } from "@/lib/today";

/** The periods the report can cover. Kept in the URL as `?range=`. */
export const REPORT_RANGES = ["week", "current", "previous"] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
/** Days the "week" range covers, today included. */
export const WEEK_DAYS = 7;

export function parseReportRange(value: string | null | undefined): ReportRange {
  return (REPORT_RANGES as readonly string[]).includes(value ?? "") ? (value as ReportRange) : "current";
}

/**
 * The days a range covers, inclusive: the last 7 days up to today, the pay month today falls in, or the one
 * before it — pay months by the payroll settings' start day (26 → from the 26th to the 25th).
 */
export function reportRangeDates(range: ReportRange, today: string, payPeriodStartDay: number): { from: string; to: string } {
  if (range === "week") return { from: addDays(today, -(WEEK_DAYS - 1)), to: today };
  const current = payPeriodOf(today, payPeriodStartDay);
  if (range === "current") return payPeriodRange(current.year, current.month, payPeriodStartDay);
  const prev = current.month === 1 ? { year: current.year - 1, month: 12 } : { year: current.year, month: current.month - 1 };
  return payPeriodRange(prev.year, prev.month, payPeriodStartDay);
}
