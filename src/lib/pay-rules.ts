// The company's internal bylaws for workers (اللائحة الداخلية لشركة أفرو إيجيبت), as the system applies them.
// Pure: no database, no dates from the clock — so every rule is tested on its own and the attendance job,
// payroll, the overtime form and the settings page all read the same numbers from here.
//
//  - Work runs 08:00 to 18:00, ten hours, with the 12:00-12:30 break inside it. There is no grace period:
//    everyone is due ten minutes early, so a punch after 08:00 is late.
//  - An hour late is deducted as two and a half hours.
//  - Overtime is paid hour for an hour and a half, only when approved.
//  - Absence: the day is deducted once when a leave was approved and asked for at least 48 hours ahead;
//    without that it counts as two days.
//  - The pay month runs from the 26th to the 25th of the next month, paid on the 1st.
//  - Everyone is paid by the day: a salaried employee's day is the salary / 30, a daily worker's the
//    salary / 26.

import { addDays } from "@/lib/today";

export const WORKDAY_HOURS = 10;
export const WORKDAY_START = "08:00";
export const WORKDAY_END = "18:00";
export const BREAK_START = "12:00";
export const BREAK_END = "12:30";
export const GRACE_MINUTES = 0;
/** Each late hour is deducted as this many hours. */
export const LATE_MULTIPLIER = 2.5;
/** Leaving early only costs the time actually missed. The bylaws don't set a penalty for it. */
export const EARLY_LEAVE_MULTIPLIER = 1;
export const OVERTIME_MULTIPLIER = 1.5;
/** How far ahead a leave must be asked for to count as a permitted absence. */
export const LEAVE_NOTICE_HOURS = 48;
export const PERMITTED_ABSENCE_DAYS = 1;
export const UNPERMITTED_ABSENCE_DAYS = 2;
/** The pay month starts on this day of the previous month and ends the day before it in the named month. */
export const PAY_PERIOD_START_DAY = 26;
export const DAY_DIVISOR = { monthly: 30, daily: 26 } as const;

export interface PayableEmployee {
  salaryType: "monthly" | "daily";
  basicSalary: number;
  dailyRate?: number | null;
}

/** One day's pay: the salary over 30 for a salaried employee, over 26 for a daily worker (whose own day
 * rate wins when one is set). Unrounded, so deductions built on it don't compound rounding. */
export function dayRate(e: PayableEmployee): number {
  if (e.salaryType === "daily") return e.dailyRate && e.dailyRate > 0 ? e.dailyRate : e.basicSalary / DAY_DIVISOR.daily;
  return e.basicSalary / DAY_DIVISOR.monthly;
}

export function hourlyRate(e: PayableEmployee): number {
  return dayRate(e) / WORKDAY_HOURS;
}

/** What a late arrival costs: each late hour counts as two and a half. */
export function lateDeduction(e: PayableEmployee, lateMinutes: number): number {
  return Math.round((Math.max(0, lateMinutes) / 60) * LATE_MULTIPLIER * hourlyRate(e));
}

export function earlyLeaveDeduction(e: PayableEmployee, earlyMinutes: number): number {
  return Math.round((Math.max(0, earlyMinutes) / 60) * EARLY_LEAVE_MULTIPLIER * hourlyRate(e));
}

/** The default overtime rate for one hour: the hourly wage times one and a half. */
export function overtimeHourlyRate(e: PayableEmployee, multiplier: number = OVERTIME_MULTIPLIER): number {
  return Math.round(hourlyRate(e) * multiplier);
}

export interface LeaveForAbsence {
  type: string;
  /** when the request was made */
  createdAt: Date;
}

/**
 * How many days' pay a day off costs, from the day's attendance status and the leave behind it, if any.
 *  - a work mission or a short approved permission: nothing, they were working;
 *  - approved leave asked for 48 hours or more before the day's start: one day;
 *  - anything else (no leave at all, or asked for too late): two days.
 * Other statuses (present, late, a missing punch for HR to review) cost nothing here.
 */
export function absenceDaysCharged(status: string, leave: LeaveForAbsence | null, dayStart: Date): number {
  if (status === "mission") return 0;
  if (status === "absent") return UNPERMITTED_ABSENCE_DAYS;
  if (status !== "leave" && status !== "excused_absence") return 0;
  if (!leave) return UNPERMITTED_ABSENCE_DAYS;
  if (leave.type === "mission" || leave.type === "permission") return 0;
  return askedInTime(leave.createdAt, dayStart) ? PERMITTED_ABSENCE_DAYS : UNPERMITTED_ABSENCE_DAYS;
}

export function askedInTime(createdAt: Date, dayStart: Date): boolean {
  return createdAt.getTime() <= dayStart.getTime() - LEAVE_NOTICE_HOURS * 60 * 60_000;
}

/** The days of the pay month named `year`/`month`: the 26th of the month before to the 25th, inclusive. */
export function payPeriodRange(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const from = `${prevYear}-${pad(prevMonth)}-${pad(PAY_PERIOD_START_DAY)}`;
  const to = addDays(`${year}-${pad(month)}-${pad(PAY_PERIOD_START_DAY)}`, -1);
  return { from, to };
}

/** The pay month a calendar day belongs to: the 26th onwards is already next month's. */
export function payPeriodOf(day: string): { year: number; month: number } {
  const [y, m, d] = day.split("-").map(Number);
  if (d < PAY_PERIOD_START_DAY) return { year: y, month: m };
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

/** Statuses of a day a daily worker is paid for as worked. A single punch still counts (HR reviews it). */
const WORKED_STATUSES = ["present", "late", "early_leave", "missing_punch", "mission"];
/** Days off whose cost is carried by an absence deduction instead of by leaving the day unpaid. */
const CHARGED_OFF_STATUSES = ["absent", "leave", "excused_absence"];

/**
 * The days a daily worker is paid at the day rate. Worked days, plus — from the day absences are tracked
 * on — days off, because those are charged through the absence deduction (one day or two), and leaving
 * them unpaid as well would charge them twice. Forgiving an absence (removing its deduction) therefore
 * pays the day.
 */
export function dailyPaidDays(days: { date: string; status: string }[], trackedFrom: string): number {
  return days.filter(
    (d) => WORKED_STATUSES.includes(d.status) || (CHARGED_OFF_STATUSES.includes(d.status) && d.date >= trackedFrom),
  ).length;
}

/** Pay day for the pay month named `year`/`month`: the 1st of the following month. */
export function payday(year: number, month: number): string {
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
