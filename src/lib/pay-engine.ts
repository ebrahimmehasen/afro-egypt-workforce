// The pay rules engine: what one day of attendance earns and costs, from the punches, the employee's
// schedule and their pay type's rules. Pure — no database and no clock — and no rule value lives here:
// every multiplier, time and threshold comes in through `PayTypeRules`, which is a row an admin edits on
// /settings. So changing overtime to 2×, or adding a new pay type, never needs a code change.

import { addDays } from "@/lib/today";

export type PayBasis = "monthly" | "daily";

/** One pay type's rules, as stored in the PayType table. */
export interface PayTypeRules {
  id: string;
  code?: string | null;
  name: string;
  basis: PayBasis;
  dayDivisor: number;
  hoursPerDay: number | null;
  workStart: string | null;
  workEnd: string | null;
  overtimeStart: string | null;
  graceMinutes: number;
  lateMultiplier: number;
  overtimeMultiplier: number;
  overtimeMinimumMinutes: number;
  overtimeStepMinutes: number;
  overtimeAutoApprove: boolean;
  permissionMultiplier: number;
  unauthorizedExitMultiplier: number;
  fridayMultiplier: number;
  holidayMultiplier: number;
  thursdayRuleEnabled: boolean;
  thursdayWorkEnd: string | null;
  thursdayExtraMultiplier: number;
  permittedAbsenceDays: number;
  unpermittedAbsenceDays: number;
  leaveNoticeHours: number;
}

/** An employee's working times for an ordinary day, before any Thursday rule. */
export interface ScheduleTimes {
  start: string;
  end: string;
  /** When overtime starts counting; usually the end. */
  overtimeStart: string;
}

export type ScheduleSource = "custom" | "schedule" | "pay_type" | "shift";

export interface ScheduleCandidates {
  custom?: { start?: string | null; end?: string | null; overtimeStart?: string | null };
  schedule?: { startTime: string; endTime: string; overtimeStart?: string | null } | null;
  payType?: Pick<PayTypeRules, "workStart" | "workEnd" | "overtimeStart"> | null;
  shift?: { startTime: string; endTime: string } | null;
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export const isTime = (v: string | null | undefined): v is string => typeof v === "string" && TIME.test(v);

/**
 * The employee's times, in order of precedence: their own custom times, their fixed schedule, their pay
 * type's times, and finally their shift (the legacy setup every employee still has). Null if none is usable.
 */
export function resolveSchedule(c: ScheduleCandidates): (ScheduleTimes & { source: ScheduleSource }) | null {
  if (isTime(c.custom?.start) && isTime(c.custom?.end)) {
    return { start: c.custom.start, end: c.custom.end, overtimeStart: isTime(c.custom.overtimeStart) ? c.custom.overtimeStart : c.custom.end, source: "custom" };
  }
  if (c.schedule && isTime(c.schedule.startTime) && isTime(c.schedule.endTime)) {
    const s = c.schedule;
    return { start: s.startTime, end: s.endTime, overtimeStart: isTime(s.overtimeStart) ? s.overtimeStart : s.endTime, source: "schedule" };
  }
  if (c.payType && isTime(c.payType.workStart) && isTime(c.payType.workEnd)) {
    const p = c.payType;
    return { start: p.workStart!, end: p.workEnd!, overtimeStart: isTime(p.overtimeStart) ? p.overtimeStart : p.workEnd!, source: "pay_type" };
  }
  if (c.shift && isTime(c.shift.startTime) && isTime(c.shift.endTime)) {
    return { start: c.shift.startTime, end: c.shift.endTime, overtimeStart: c.shift.endTime, source: "shift" };
  }
  return null;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** A time of day on a given date, as a local Date; `after` makes it roll to the next day if it's earlier. */
function at(date: string, hhmm: string, after?: string): Date {
  const day = after && minutesOf(hhmm) <= minutesOf(after) && hhmm !== after ? addDays(date, 1) : date;
  return new Date(`${day}T${hhmm.padStart(5, "0")}:00`);
}

export interface DayTimes {
  start: Date;
  /** The end of the working day — Thursday's shorter end when that rule applies. */
  end: Date;
  overtimeStart: Date;
  /** Thursday only: the stretch between the short end and the usual overtime start. */
  thursdayExtra: { from: Date; to: Date } | null;
}

/** The day's actual start / end / overtime start, with the Thursday rule applied. */
export function dayTimes(date: string, schedule: ScheduleTimes, rules: PayTypeRules): DayTimes {
  const start = at(date, schedule.start);
  const regularEnd = at(date, schedule.end, schedule.start);
  const overtimeStart = at(date, schedule.overtimeStart, schedule.start);
  if (rules.thursdayRuleEnabled && isTime(rules.thursdayWorkEnd) && weekday(date) === 4) {
    const thursdayEnd = at(date, rules.thursdayWorkEnd, schedule.start);
    if (thursdayEnd < regularEnd) {
      return { start, end: thursdayEnd, overtimeStart, thursdayExtra: thursdayEnd < overtimeStart ? { from: thursdayEnd, to: overtimeStart } : null };
    }
  }
  return { start, end: regularEnd, overtimeStart, thursdayExtra: null };
}

export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** A day's pay: the salary over the pay type's divisor, or a daily worker's own day rate when set. */
export function dayRate(rules: Pick<PayTypeRules, "basis" | "dayDivisor">, pay: { basicSalary: number; dailyRate?: number | null }): number {
  if (rules.basis === "daily" && pay.dailyRate && pay.dailyRate > 0) return pay.dailyRate;
  return rules.dayDivisor > 0 ? pay.basicSalary / rules.dayDivisor : 0;
}

/** Hours a day's pay covers: the pay type's own number, or the schedule's start → overtime start. */
export function paidHoursPerDay(rules: Pick<PayTypeRules, "hoursPerDay">, schedule: ScheduleTimes): number {
  if (rules.hoursPerDay && rules.hoursPerDay > 0) return rules.hoursPerDay;
  let span = minutesOf(schedule.overtimeStart) - minutesOf(schedule.start);
  if (span <= 0) span += 24 * 60;
  return span / 60;
}

export function hourlyRate(rules: PayTypeRules, schedule: ScheduleTimes, pay: { basicSalary: number; dailyRate?: number | null }): number {
  const hours = paidHoursPerDay(rules, schedule);
  return hours > 0 ? dayRate(rules, pay) / hours : 0;
}

/** Overtime that counts: nothing under the minimum, then whole steps only (60 = whole hours). */
export function countedOvertimeMinutes(rawMinutes: number, rules: Pick<PayTypeRules, "overtimeMinimumMinutes" | "overtimeStepMinutes">): number {
  if (rawMinutes <= 0 || rawMinutes < rules.overtimeMinimumMinutes) return 0;
  const step = rules.overtimeStepMinutes > 0 ? rules.overtimeStepMinutes : 1;
  return Math.floor(rawMinutes / step + 1e-9) * step;
}

export type DayKind = "workday" | "weekly_off" | "holiday";

export type PayItemKind = "late" | "permission" | "unauthorized_exit" | "overtime" | "friday" | "holiday" | "thursday_extra";

export interface PayItem {
  kind: PayItemKind;
  direction: "deduction" | "addition";
  /** The time it is about, in minutes (late minutes, missed minutes, counted overtime minutes…). */
  minutes: number;
  multiplier: number;
  /** minutes / 60 × multiplier: the hours of pay it is worth. */
  payHours: number;
  /** In EGP, rounded to the pound like every other amount in the system. */
  amount: number;
}

export interface DayPayInput {
  date: string;
  kind: DayKind;
  schedule: ScheduleTimes;
  rules: PayTypeRules;
  pay: { basicSalary: number; dailyRate?: number | null };
  actualIn: Date | null;
  actualOut: Date | null;
  /** An approved permission to leave for the rest of the day. */
  hasPermission: boolean;
}

export interface DayPay {
  times: DayTimes;
  hourlyRate: number;
  /** Time between the punches, in minutes. */
  workedMinutes: number;
  /** Late minutes that count (after any grace), to the second. */
  lateMinutes: number;
  /** Minutes missed before the end of the day. */
  earlyMinutes: number;
  /** Minutes after the overtime start, before rounding, and the part that counts. */
  overtimeRawMinutes: number;
  overtimeCountedMinutes: number;
  items: PayItem[];
}

const MS_PER_MIN = 60_000;

/**
 * What one day earns and costs. On the weekly day off or a public holiday, every hour worked pays that
 * day's multiplier and nothing is charged. On a working day: lateness per minute (to the second), time
 * missed at the end (at the permission or the unauthorized-exit multiplier), Thursday's extra time at its
 * own rate, and overtime in counted steps. A day with only one punch earns and costs nothing here — HR
 * reviews it first.
 */
export function computeDayPay(input: DayPayInput): DayPay {
  const { rules, schedule, actualIn, actualOut } = input;
  const times = dayTimes(input.date, schedule, rules);
  const hourly = hourlyRate(rules, schedule, input.pay);
  const items: PayItem[] = [];
  const item = (kind: PayItemKind, direction: PayItem["direction"], minutes: number, multiplier: number) => {
    if (minutes <= 0 || multiplier <= 0) return;
    const payHours = (minutes / 60) * multiplier;
    items.push({ kind, direction, minutes, multiplier, payHours, amount: Math.round(payHours * hourly) });
  };

  const empty: DayPay = { times, hourlyRate: hourly, workedMinutes: 0, lateMinutes: 0, earlyMinutes: 0, overtimeRawMinutes: 0, overtimeCountedMinutes: 0, items };
  if (!actualIn || !actualOut || actualOut <= actualIn) return empty;

  const workedMinutes = (actualOut.getTime() - actualIn.getTime()) / MS_PER_MIN;

  if (input.kind !== "workday") {
    item(input.kind === "holiday" ? "holiday" : "friday", "addition", workedMinutes, input.kind === "holiday" ? rules.holidayMultiplier : rules.fridayMultiplier);
    return { ...empty, workedMinutes };
  }

  const rawLate = Math.max(0, (actualIn.getTime() - times.start.getTime()) / MS_PER_MIN);
  const lateMinutes = rawLate > rules.graceMinutes ? rawLate - rules.graceMinutes : 0;
  item("late", "deduction", lateMinutes, rules.lateMultiplier);

  const earlyMinutes = Math.max(0, (times.end.getTime() - actualOut.getTime()) / MS_PER_MIN);
  if (input.hasPermission) item("permission", "deduction", earlyMinutes, rules.permissionMultiplier);
  else item("unauthorized_exit", "deduction", earlyMinutes, rules.unauthorizedExitMultiplier);

  if (times.thursdayExtra) {
    const from = Math.max(times.thursdayExtra.from.getTime(), actualIn.getTime());
    const to = Math.min(times.thursdayExtra.to.getTime(), actualOut.getTime());
    item("thursday_extra", "addition", Math.max(0, (to - from) / MS_PER_MIN), rules.thursdayExtraMultiplier);
  }

  const overtimeFrom = Math.max(times.overtimeStart.getTime(), actualIn.getTime());
  const overtimeRawMinutes = Math.max(0, (actualOut.getTime() - overtimeFrom) / MS_PER_MIN);
  const overtimeCountedMinutes = countedOvertimeMinutes(overtimeRawMinutes, rules);
  item("overtime", "addition", overtimeCountedMinutes, rules.overtimeMultiplier);

  return { times, hourlyRate: hourly, workedMinutes, lateMinutes, earlyMinutes, overtimeRawMinutes, overtimeCountedMinutes, items };
}

export interface LeaveForAbsence {
  type: string;
  createdAt: Date;
}

/**
 * Days of pay a day off costs, by the pay type's rules: a mission or a short permission costs nothing;
 * approved leave asked for `leaveNoticeHours` ahead costs `permittedAbsenceDays`; anything else
 * (no leave, or asked too late) `unpermittedAbsenceDays`.
 */
export function absenceDaysCharged(
  status: string,
  leave: LeaveForAbsence | null,
  dayStart: Date,
  rules: Pick<PayTypeRules, "permittedAbsenceDays" | "unpermittedAbsenceDays" | "leaveNoticeHours">,
): number {
  if (status === "mission") return 0;
  if (status === "absent") return rules.unpermittedAbsenceDays;
  if (status !== "leave" && status !== "excused_absence") return 0;
  if (!leave) return rules.unpermittedAbsenceDays;
  if (leave.type === "mission" || leave.type === "permission") return 0;
  const inTime = leave.createdAt.getTime() <= dayStart.getTime() - rules.leaveNoticeHours * 3_600_000;
  return inTime ? rules.permittedAbsenceDays : rules.unpermittedAbsenceDays;
}

/** "5" / "5,6" → [5] / [5, 6]; anything unreadable is dropped. */
export function parseWeeklyOffDays(value: string | null | undefined): number[] {
  return (value ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

/** What kind of day a date is for pay: a public holiday, the weekly day off, or a working day. */
export function dayKind(date: string, weeklyOffDays: readonly number[], holidays: readonly { from: string; to: string }[]): DayKind {
  if (holidays.some((h) => date >= h.from && date <= h.to)) return "holiday";
  if (weeklyOffDays.includes(weekday(date))) return "weekly_off";
  return "workday";
}
