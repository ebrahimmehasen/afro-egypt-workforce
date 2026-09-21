import { prisma } from "@/lib/prisma";
import { ABSENCE_TRACKING_FROM } from "@/lib/attendance-engine";
import { getDictionary } from "@/lib/i18n";
import { dayStr } from "@/lib/serialize";
import { addDays, localDay } from "@/lib/today";
import { LeaveForAbsence, PayItem, PayTypeRules, ScheduleTimes, absenceDaysCharged, computeDayPay, dayRate, DayKind } from "@/lib/pay-engine";
import { PayContext, PayEmployee, kindOf, loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { payPeriodOf } from "@/lib/pay-rules";

// Posts what each finished day of attendance costs and earns, by the employee's pay-type rules: deductions
// (absence, lateness, permission, leaving without permission) to the Deduction table and additions
// (overtime, weekly-day-off and holiday work, Thursday's extra time) to the Overtime table — both marked
// as the system's, with the calculated value kept even after someone edits it.

export type SystemDeductionType = "late" | "absence" | "permission" | "unauthorized_exit";
export type SystemAdditionKind = "overtime" | "friday" | "holiday" | "thursday_extra";

export interface SystemDeduction {
  systemKey: string;
  employeeId: string;
  date: string;
  type: SystemDeductionType;
  amount: number;
  reason: string;
}

export interface SystemAddition {
  systemKey: string;
  employeeId: string;
  date: string;
  kind: SystemAdditionKind;
  /** counted hours worked (not multiplied) */
  hours: number;
  multiplier: number;
  /** pay for one counted hour: hourly wage × multiplier */
  hourlyRate: number;
  amount: number;
  reason: string;
  autoApprove: boolean;
}

export interface AttendanceDay {
  employeeId: string;
  date: string;
  status: string;
  actualIn: Date | null;
  actualOut: Date | null;
  scheduledStart: Date;
}

export const systemKey = (employeeId: string, date: string, type: string) => `${employeeId}|${date}|${type}`;

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const minutesText = (m: number) => `${fmt(m)} دقيقة`;
const hoursText = (m: number) => `${fmt(m / 60)} ساعة`;

/** Reasons are written in Arabic, the company's working language, and say which rule and number applied. */
function reasonFor(item: PayItem): string {
  switch (item.kind) {
    case "late":
      return `تأخير ${minutesText(item.minutes)} × ${fmt(item.multiplier)} = ${minutesText(item.minutes * item.multiplier)} خصم`;
    case "permission":
      return `إذن لباقي اليوم ${hoursText(item.minutes)} × ${fmt(item.multiplier)}`;
    case "unauthorized_exit":
      return `خروج بدون إذن ${hoursText(item.minutes)} × ${fmt(item.multiplier)}`;
    case "overtime":
      return `إضافي ${hoursText(item.minutes)} × ${fmt(item.multiplier)} = ${fmt(item.payHours)} ساعة أجر`;
    case "friday":
      return `عمل يوم الإجازة الأسبوعية ${hoursText(item.minutes)} × ${fmt(item.multiplier)} = ${fmt(item.payHours)} ساعة أجر`;
    case "holiday":
      return `عمل في إجازة رسمية ${hoursText(item.minutes)} × ${fmt(item.multiplier)} = ${fmt(item.payHours)} ساعة أجر`;
    case "thursday_extra":
      return `وقت الخميس بعد نهاية اليوم ${hoursText(item.minutes)} × ${fmt(item.multiplier)} (وقت عادي)`;
  }
}

/**
 * Everything the pay rules put on one finished day: an absence charge for a day off, or — on a day worked —
 * the day's pay items (lateness, early leave, overtime, Thursday time, weekly-day-off / holiday work).
 * Zero amounts (e.g. no salary entered yet) are left out rather than posted as empty rows.
 */
export function systemEntriesFor(
  day: AttendanceDay,
  employee: PayEmployee,
  rules: PayTypeRules,
  schedule: ScheduleTimes,
  kind: DayKind,
  leave: (LeaveForAbsence & { type: string }) | null,
): { deductions: SystemDeduction[]; additions: SystemAddition[] } {
  const deductions: SystemDeduction[] = [];
  const additions: SystemAddition[] = [];

  const days = kind === "workday" ? absenceDaysCharged(day.status, leave, day.scheduledStart, rules) : 0;
  if (days > 0) {
    const amount = Math.round(days * dayRate(rules, employee));
    if (amount > 0) {
      deductions.push({
        systemKey: systemKey(day.employeeId, day.date, "absence"),
        employeeId: day.employeeId,
        date: day.date,
        type: "absence",
        amount,
        reason: days === rules.permittedAbsenceDays && leave ? `غياب بإذن معتمد مسبقاً — اليوم × ${fmt(days)}` : `غياب بدون إذن مسبق — اليوم × ${fmt(days)}`,
      });
    }
    return { deductions, additions };
  }

  const pay = computeDayPay({
    date: day.date,
    kind,
    schedule,
    rules,
    pay: employee,
    actualIn: day.actualIn,
    actualOut: day.actualOut,
    hasPermission: leave?.type === "permission",
  });
  for (const item of pay.items) {
    if (item.amount <= 0) continue;
    if (item.direction === "deduction") {
      deductions.push({
        systemKey: systemKey(day.employeeId, day.date, item.kind),
        employeeId: day.employeeId,
        date: day.date,
        type: item.kind as SystemDeductionType,
        amount: item.amount,
        reason: reasonFor(item),
      });
    } else {
      additions.push({
        systemKey: systemKey(day.employeeId, day.date, item.kind),
        employeeId: day.employeeId,
        date: day.date,
        kind: item.kind as SystemAdditionKind,
        hours: Math.round((item.minutes / 60) * 100) / 100,
        multiplier: item.multiplier,
        hourlyRate: Math.round(pay.hourlyRate * item.multiplier),
        amount: item.amount,
        reason: reasonFor(item),
        autoApprove: rules.overtimeAutoApprove,
      });
    }
  }
  return { deductions, additions };
}

export interface ExistingSystemRow {
  id: string;
  systemKey: string;
  amount: number;
  reason: string;
  edited: boolean;
  voided: boolean;
}

/**
 * What to change so the posted rows match the days: create what's missing, update what changed, and remove
 * what no longer applies (the day was corrected, a leave was approved). A row someone edited or removed by
 * hand is theirs — it is never touched again, and a removed one is never posted again.
 */
export function planSystemRows<T extends { systemKey: string; amount: number; reason: string }>(desired: T[], existing: ExistingSystemRow[]) {
  const byKey = new Map(existing.map((e) => [e.systemKey, e]));
  const wanted = new Set(desired.map((d) => d.systemKey));
  const create: T[] = [];
  const update: { id: string; row: T }[] = [];
  for (const d of desired) {
    const e = byKey.get(d.systemKey);
    if (!e) create.push(d);
    else if (!e.edited && !e.voided && (e.amount !== d.amount || e.reason !== d.reason)) update.push({ id: e.id, row: d });
  }
  const remove = existing.filter((e) => !wanted.has(e.systemKey) && !e.edited && !e.voided).map((e) => e.id);
  return { create, update, remove };
}

/** How far back the job keeps entries in step: a little over two pay months. */
const LOOKBACK_DAYS = 70;

/**
 * Posts (and keeps in step) the entries for every finished day. Only days before today, so a day is only
 * charged once it's over, never before absences are tracked, and never inside a pay month that has already
 * been approved or closed — those keep exactly what they had.
 */
export async function postAttendanceDeductions(now: Date = new Date()): Promise<{ created: number; updated: number; removed: number }> {
  const today = localDay(now);
  const lastDay = addDays(today, -1);
  const lookback = addDays(today, -LOOKBACK_DAYS);
  const firstDay = lookback > ABSENCE_TRACKING_FROM ? lookback : ABSENCE_TRACKING_FROM;
  const none = { created: 0, updated: 0, removed: 0 };
  if (lastDay < firstDay) return none;

  const range = { gte: new Date(`${firstDay}T00:00:00.000Z`), lte: new Date(`${lastDay}T00:00:00.000Z`) };
  const [days, employees, leaves, periods, existingDeductions, existingAdditions, ctx] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { date: range } }),
    prisma.employee.findMany({ where: { deletedAt: null } }),
    prisma.leave.findMany({ where: { status: "approved", to: { gte: range.gte }, from: { lte: range.lte } } }),
    prisma.payrollPeriod.findMany({ where: { status: { in: ["approved", "closed"] } } }),
    prisma.deduction.findMany({ where: { autoGenerated: true, systemKey: { not: null }, date: range } }),
    prisma.overtime.findMany({ where: { autoGenerated: true, systemKey: { not: null }, date: range } }),
    loadPayContext(),
  ]);

  const isLocked = lockedDayCheck(periods, ctx);
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const desiredDeductions: SystemDeduction[] = [];
  const desiredAdditions: SystemAddition[] = [];
  for (const d of days) {
    const date = dayStr(d.date);
    const employee = employeeById.get(d.employeeId);
    if (!employee || isLocked(date)) continue;
    const leave = leaves.find((l) => l.employeeId === d.employeeId && dayStr(l.from) <= date && dayStr(l.to) >= date) ?? null;
    const entries = systemEntriesFor(
      { employeeId: d.employeeId, date, status: d.status, actualIn: d.actualIn, actualOut: d.actualOut, scheduledStart: d.scheduledStart },
      employee,
      rulesFor(ctx, employee),
      scheduleFor(ctx, employee),
      kindOf(ctx, date),
      leave,
    );
    desiredDeductions.push(...entries.deductions);
    desiredAdditions.push(...entries.additions);
  }

  const asExisting = (rows: { id: string; systemKey: string | null; amount: number; reason?: string; notes?: string | null; editedAt: Date | null; voidedAt: Date | null; date: Date }[], reasonOf: (r: (typeof rows)[number]) => string) =>
    rows
      .filter((e) => !isLocked(dayStr(e.date)))
      .map((e) => ({ id: e.id, systemKey: e.systemKey!, amount: e.amount, reason: reasonOf(e), edited: Boolean(e.editedAt), voided: Boolean(e.voidedAt) }));

  const dPlan = planSystemRows(desiredDeductions, asExisting(existingDeductions, (r) => r.reason ?? ""));
  const aPlan = planSystemRows(desiredAdditions, asExisting(existingAdditions, (r) => r.notes ?? ""));

  const created = dPlan.create.length + aPlan.create.length;
  const updated = dPlan.update.length + aPlan.update.length;
  const removed = dPlan.remove.length + aPlan.remove.length;
  if (created + updated + removed === 0) return none;

  // Signed by the system, not by whoever happened to be logged in.
  const t = getDictionary("ar");
  await prisma.$transaction(async (tx) => {
    for (const c of dPlan.create) {
      await tx.deduction.create({
        data: {
          employeeId: c.employeeId,
          type: c.type,
          amount: c.amount,
          originalAmount: c.amount,
          date: new Date(`${c.date}T00:00:00.000Z`),
          reason: c.reason,
          autoGenerated: true,
          systemKey: c.systemKey,
        },
      });
    }
    for (const u of dPlan.update) {
      await tx.deduction.update({ where: { id: u.id }, data: { amount: u.row.amount, originalAmount: u.row.amount, reason: u.row.reason } });
    }
    if (dPlan.remove.length > 0) await tx.deduction.deleteMany({ where: { id: { in: dPlan.remove } } });

    for (const c of aPlan.create) {
      await tx.overtime.create({
        data: {
          employeeId: c.employeeId,
          date: new Date(`${c.date}T00:00:00.000Z`),
          kind: c.kind,
          hours: c.hours,
          multiplier: c.multiplier,
          hourlyRate: c.hourlyRate,
          amount: c.amount,
          originalHours: c.hours,
          originalAmount: c.amount,
          notes: c.reason,
          status: c.autoApprove ? "approved" : "pending",
          approvedBy: c.autoApprove ? t.auditActions.system : null,
          autoGenerated: true,
          systemKey: c.systemKey,
        },
      });
    }
    // an update never changes the approval status: someone may already have decided on it
    for (const u of aPlan.update) {
      await tx.overtime.update({
        where: { id: u.id },
        data: {
          hours: u.row.hours,
          multiplier: u.row.multiplier,
          hourlyRate: u.row.hourlyRate,
          amount: u.row.amount,
          originalHours: u.row.hours,
          originalAmount: u.row.amount,
          notes: u.row.reason,
        },
      });
    }
    if (aPlan.remove.length > 0) await tx.overtime.deleteMany({ where: { id: { in: aPlan.remove } } });

    await tx.auditLogEntry.create({
      data: {
        userName: t.auditActions.system,
        module: t.nav.deductions,
        action: t.auditActions.systemDeductions,
        oldValue: "-",
        newValue: `+${created} / ~${updated} / -${removed}`,
      },
    });
  });
  return { created, updated, removed };
}

/** A day belongs to a pay month that is approved or closed: its pay must not change any more. */
export function lockedDayCheck(periods: { year: number; month: number }[], ctx: Pick<PayContext, "payPeriodStartDay">) {
  const locked = new Set(periods.map((p) => `${p.year}-${p.month}`));
  return (day: string) => {
    const p = payPeriodOf(day, ctx.payPeriodStartDay);
    return locked.has(`${p.year}-${p.month}`);
  };
}
