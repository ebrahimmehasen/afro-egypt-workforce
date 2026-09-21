import { prisma } from "@/lib/prisma";
import { dayStr, toShift } from "@/lib/serialize";
import {
  DayKind,
  PayTypeRules,
  ScheduleTimes,
  dayKind,
  dayTimes,
  parseWeeklyOffDays,
  resolveSchedule,
} from "@/lib/pay-engine";
import { FALLBACK_PAY_PERIOD_START_DAY, FALLBACK_PAY_TYPES, FALLBACK_WEEKLY_OFF_DAYS } from "@/lib/pay-defaults";
import { Shift } from "@/lib/types";

export interface WorkScheduleRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  overtimeStart: string | null;
  active: boolean;
  sortOrder: number;
  deletedAt: string | null;
}

/** Everything pay calculations read from settings, loaded once per job or page. */
export interface PayContext {
  /** Every pay type, soft-deleted ones included: an employee on one still resolves it. */
  payTypes: (PayTypeRules & { active: boolean; deletedAt: string | null })[];
  schedules: WorkScheduleRow[];
  shifts: Shift[];
  weeklyOffDays: number[];
  holidays: { from: string; to: string }[];
  payPeriodStartDay: number;
}

export interface PayEmployee {
  id: string;
  shiftId: string;
  salaryType: "monthly" | "daily";
  payTypeId?: string | null;
  workScheduleId?: string | null;
  customWorkStart?: string | null;
  customWorkEnd?: string | null;
  customOvertimeStart?: string | null;
  basicSalary: number;
  dailyRate?: number | null;
}

export function toPayTypeRules(p: Awaited<ReturnType<typeof prisma.payType.findMany>>[number]): PayTypeRules {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    basis: p.basis,
    dayDivisor: p.dayDivisor,
    hoursPerDay: p.hoursPerDay,
    workStart: p.workStart,
    workEnd: p.workEnd,
    overtimeStart: p.overtimeStart,
    graceMinutes: p.graceMinutes,
    lateMultiplier: p.lateMultiplier,
    overtimeMultiplier: p.overtimeMultiplier,
    overtimeMinimumMinutes: p.overtimeMinimumMinutes,
    overtimeStepMinutes: p.overtimeStepMinutes,
    overtimeAutoApprove: p.overtimeAutoApprove,
    permissionMultiplier: p.permissionMultiplier,
    unauthorizedExitMultiplier: p.unauthorizedExitMultiplier,
    fridayMultiplier: p.fridayMultiplier,
    holidayMultiplier: p.holidayMultiplier,
    thursdayRuleEnabled: p.thursdayRuleEnabled,
    thursdayWorkEnd: p.thursdayWorkEnd,
    thursdayExtraMultiplier: p.thursdayExtraMultiplier,
    permittedAbsenceDays: p.permittedAbsenceDays,
    unpermittedAbsenceDays: p.unpermittedAbsenceDays,
    leaveNoticeHours: p.leaveNoticeHours,
  };
}

export async function loadPayContext(): Promise<PayContext> {
  const [payTypes, schedules, shifts, holidays, attendance, payroll] = await Promise.all([
    prisma.payType.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.workSchedule.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.shift.findMany(),
    prisma.holiday.findMany(),
    prisma.attendanceSettings.findUnique({ where: { id: "singleton" } }),
    prisma.payrollSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  return {
    payTypes: payTypes.map((p) => ({ ...toPayTypeRules(p), active: p.active, deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null })),
    schedules: schedules.map((s) => ({ ...s, deletedAt: s.deletedAt ? s.deletedAt.toISOString() : null })),
    shifts: shifts.map(toShift),
    weeklyOffDays: parseWeeklyOffDays(attendance?.weeklyOffDays ?? FALLBACK_WEEKLY_OFF_DAYS),
    holidays: holidays.map((h) => ({ from: dayStr(h.from), to: dayStr(h.to) })),
    payPeriodStartDay: payroll?.payPeriodStartDay ?? FALLBACK_PAY_PERIOD_START_DAY,
  };
}

/** The employee's pay type: theirs, else the built-in one for their pay basis, else the safety-net defaults. */
export function rulesFor(ctx: Pick<PayContext, "payTypes">, e: Pick<PayEmployee, "payTypeId" | "salaryType">): PayTypeRules {
  return (
    (e.payTypeId ? ctx.payTypes.find((p) => p.id === e.payTypeId) : undefined) ??
    ctx.payTypes.find((p) => p.code === e.salaryType) ??
    FALLBACK_PAY_TYPES[e.salaryType]
  );
}

/** The employee's ordinary working times (custom → schedule → pay type → shift). */
export function scheduleFor(ctx: PayContext, e: PayEmployee): ScheduleTimes {
  const rules = rulesFor(ctx, e);
  const resolved = resolveSchedule({
    custom: { start: e.customWorkStart, end: e.customWorkEnd, overtimeStart: e.customOvertimeStart },
    schedule: e.workScheduleId ? ctx.schedules.find((s) => s.id === e.workScheduleId) : null,
    payType: rules,
    shift: ctx.shifts.find((s) => s.id === e.shiftId),
  });
  // nothing usable at all (a pay type without times and no shift): the built-in type's times
  return resolved ?? resolveSchedule({ payType: FALLBACK_PAY_TYPES[rules.basis] })!;
}

export function kindOf(ctx: Pick<PayContext, "weeklyOffDays" | "holidays">, date: string): DayKind {
  return dayKind(date, ctx.weeklyOffDays, ctx.holidays);
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * The employee's day as a Shift for the attendance engine: their schedule's start, the day's end (Thursday's
 * short end when that rule applies), and the pay type's grace. Keeps the engine — and the status it shows
 * (late, early leave…) — in step with the pay rules without changing it.
 */
export function effectiveShift(ctx: PayContext, e: PayEmployee, date: string): Shift {
  const rules = rulesFor(ctx, e);
  const schedule = scheduleFor(ctx, e);
  const times = dayTimes(date, schedule, rules);
  const base = ctx.shifts.find((s) => s.id === e.shiftId);
  return {
    id: e.shiftId,
    name: base?.name ?? "",
    startTime: schedule.start,
    endTime: hhmm(times.end),
    gracePeriodMinutes: rules.graceMinutes,
    workDays: base?.workDays ?? [],
    allowOvertime: base?.allowOvertime ?? true,
  };
}

/**
 * What the employee form offers: pay types and fixed schedules that are active, plus the employee's own
 * current ones even if they have since been retired, so editing them never silently switches them.
 */
export function employeeFormOptions(ctx: PayContext, current?: { payTypeId?: string | null; workScheduleId?: string | null }) {
  return {
    payTypes: ctx.payTypes
      .filter((p) => p.id === current?.payTypeId || (p.active && !p.deletedAt))
      .map((p) => ({ id: p.id, code: p.code ?? null, name: p.name, basis: p.basis, dayDivisor: p.dayDivisor, workStart: p.workStart, workEnd: p.workEnd, overtimeStart: p.overtimeStart })),
    schedules: ctx.schedules
      .filter((s) => s.id === current?.workScheduleId || (s.active && !s.deletedAt))
      .map((s) => ({ id: s.id, name: s.name })),
  };
}
