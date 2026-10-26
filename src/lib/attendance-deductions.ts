import { prisma } from "@/lib/prisma";
import { ABSENCE_TRACKING_FROM } from "@/lib/attendance-engine";
import { getDictionary } from "@/lib/i18n";
import { dayStr } from "@/lib/serialize";
import { addDays, localDay } from "@/lib/today";
import { DayPay, DayPayInput, LeaveForAbsence, PayItem, PayTypeRules, ScheduleTimes, absenceDaysCharged, computeDayPay, dayRate, DayKind } from "@/lib/pay-engine";
import { PayContext, PayEmployee, effectiveShift, kindOf, loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { punchWindow } from "@/lib/attendance-ingest";
import { MidDayAnalysis } from "@/lib/mid-day-exits";
import { payPeriodOf } from "@/lib/pay-rules";
import { DayCharge, leaveCharges } from "@/lib/leave-balance";
import { trackedAbsentDays } from "@/lib/leave-days";

// Posts what each finished day of attendance costs and earns, by the employee's pay-type rules: deductions
// (absence, lateness, permission, leaving without permission) to the Deduction table and additions
// (overtime, weekly-day-off and holiday work, Thursday's extra time) to the Overtime table — both marked
// as the system's, with the calculated value kept even after someone edits it.

export type SystemDeductionType = "late" | "absence" | "permission" | "unauthorized_exit" | "permission_overrun";
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
  /** corrected by HR: their check-in / check-out stand, and the punches in between are not read */
  corrected?: boolean;
}

export const systemKey = (employeeId: string, date: string, type: string) => `${employeeId}|${date}|${type}`;

/** A permission filed with a time and a duration (older permissions have neither: they are for the rest of the day). */
export const isTimedPermission = (l: { type: string; startTime?: string | null; durationMinutes?: number | null }) =>
  l.type === "permission" && Boolean(l.startTime) && (l.durationMinutes ?? 0) > 0;

/** The approved timed permissions among a day's leaves, as the pay engine reads them. */
export function timedPermissions(leaves: { id: string; type: string; status?: string; startTime?: string | null; durationMinutes?: number | null }[]) {
  return leaves
    .filter((l) => isTimedPermission(l) && (l.status === undefined || l.status === "approved"))
    .map((l) => ({ id: l.id, startTime: l.startTime!, durationMinutes: l.durationMinutes! }));
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const minutesText = (m: number) => `${fmt(m)} دقيقة`;
const hoursText = (m: number) => `${fmt(m / 60)} ساعة`;

const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const MS_PER_MIN = 60_000;

/** "30 دقيقة × 1.5 = 45 دقيقة خصم" — the charged minutes and what they come to. */
const charged = (minutes: number, multiplier: number) => `${minutesText(minutes)} × ${fmt(multiplier)} = ${minutesText(minutes * multiplier)} خصم`;
/** "30 دقيقة" — or, when the grace took some of it, "30 دقيقة، بعد السماح 25 دقيقة". */
const graced = (minutes: number, counted: number) => (counted === minutes ? minutesText(minutes) : `${minutesText(minutes)}، بعد السماح ${minutesText(counted)}`);

/**
 * The parts of the permission, leaving-without-permission and past-the-permission items that come from timed
 * permissions and exits in the middle of the day, one text per stretch. Empty when the day had none — then the
 * item's reason is exactly what it always was.
 */
function midDayParts(kind: PayItem["kind"], multiplier: number, midDay: MidDayAnalysis | null, dayEnd: Date): string[] {
  if (!midDay) return [];
  const parts: string[] = [];
  const intervals = midDay.missingPunch ? [] : midDay.intervals;
  const final = midDay.finalExit;
  if (kind === "permission") {
    for (const i of intervals) {
      if (!i.permission || i.permissionMinutes <= 0) continue;
      const head = `إذن ${minutesText(i.permission.durationMinutes)} — خرج ${clock(i.out)} ورجع ${clock(i.back!)}`;
      parts.push(
        i.permissionMinutes === i.minutes
          ? `${head} = ${charged(i.permissionMinutes, multiplier)}`
          : `${head} = ${minutesText(i.minutes)} — الإذن ${fmt(i.permissionMinutes)} × ${fmt(multiplier)} = ${minutesText(i.permissionMinutes * multiplier)} خصم`,
      );
    }
    if (final && final.permissionMinutes > 0) {
      parts.push(
        final.case === 3
          ? `إذن ${minutesText(final.permission.durationMinutes)} — خرج ${clock(final.out)} ومارجعش — الإذن ${fmt(final.permissionMinutes)} × ${fmt(multiplier)} = ${minutesText(final.permissionMinutes * multiplier)} خصم`
          : `إذن لباقي اليوم من ${clock(final.permission.start)} — خرج ${clock(final.out)} ونهاية الدوام ${clock(dayEnd)} = ${charged(final.permissionMinutes, multiplier)}`,
      );
    }
  } else if (kind === "unauthorized_exit") {
    for (const i of intervals) {
      if (i.unauthorizedCharged <= 0) continue;
      parts.push(
        i.permission
          ? `خروج قبل الإذن — خرج ${clock(i.out)} والإذن من ${clock(i.permission.start)} = ${graced(i.unauthorizedMinutes, i.unauthorizedCharged)} × ${fmt(multiplier)} = ${minutesText(i.unauthorizedCharged * multiplier)} خصم`
          : `خروج بدون إذن — ${clock(i.out)} ← ${clock(i.back!)} = ${graced(i.unauthorizedMinutes, i.unauthorizedCharged)} × ${fmt(multiplier)} = ${minutesText(i.unauthorizedCharged * multiplier)} خصم`,
      );
    }
    if (final && final.beforeCharged > 0) {
      parts.push(
        `خروج قبل الإذن — خرج ${clock(final.out)} والإذن من ${clock(final.permission.start)} = ${graced(final.beforeMinutes, final.beforeCharged)} × ${fmt(multiplier)} = ${minutesText(final.beforeCharged * multiplier)} خصم`,
      );
    }
    if (final && final.afterMinutes > 0) {
      const permissionEnd = new Date(Math.max(final.out.getTime(), final.permission.start.getTime()) + final.permission.durationMinutes * MS_PER_MIN);
      parts.push(`خروج بدون إذن بعد نهاية الإذن — ${clock(permissionEnd)} ← ${clock(dayEnd)} = ${charged(final.afterMinutes, multiplier)}`);
    }
  } else if (kind === "permission_overrun") {
    for (const i of intervals) {
      if (!i.permission || i.overrunCharged <= 0) continue;
      parts.push(
        `زيادة عن الإذن ${graced(i.overrunMinutes, i.overrunCharged)} × ${fmt(multiplier)} = ${minutesText(i.overrunCharged * multiplier)} خصم — إذن ${minutesText(i.permission.durationMinutes)}، خرج ${clock(i.out)} ورجع ${clock(i.back!)} = ${minutesText(i.minutes)}`,
      );
    }
  }
  return parts;
}

/**
 * Reasons are written in Arabic, the company's working language, and say which rule and number applied. An item
 * that also holds timed permissions or exits in the middle of the day spells out each stretch, then the
 * end-of-day part (if any) as it was always written.
 */
function reasonFor(item: PayItem, pay?: DayPay, hasPermission = false): string {
  if (pay?.midDay && (item.kind === "permission" || item.kind === "unauthorized_exit" || item.kind === "permission_overrun")) {
    const parts = midDayParts(item.kind, item.multiplier, pay.midDay, pay.times.end);
    if (parts.length > 0) {
      // the check-out charged by the rule for the rest of the day, when no timed permission covered it
      const legacyEnd = pay.midDay.finalExit ? 0 : pay.earlyMinutes;
      if (item.kind === "permission" && hasPermission && legacyEnd > 0) parts.push(`إذن لباقي اليوم ${hoursText(legacyEnd)} × ${fmt(item.multiplier)}`);
      if (item.kind === "unauthorized_exit" && !hasPermission && legacyEnd > 0) parts.push(`خروج بدون إذن ${hoursText(legacyEnd)} × ${fmt(item.multiplier)}`);
      return parts.join(" | ");
    }
  }
  switch (item.kind) {
    case "late":
      return `تأخير ${minutesText(item.minutes)} × ${fmt(item.multiplier)} = ${minutesText(item.minutes * item.multiplier)} خصم`;
    case "permission":
      return `إذن لباقي اليوم ${hoursText(item.minutes)} × ${fmt(item.multiplier)}`;
    case "unauthorized_exit":
      return `خروج بدون إذن ${hoursText(item.minutes)} × ${fmt(item.multiplier)}`;
    case "permission_overrun":
      return `زيادة عن الإذن ${charged(item.minutes, item.multiplier)}`;
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
 *
 * `charge` is what the annual-leave balance made of the day (see leaveCharges): a day of absence the balance
 * covered costs no pay at all; one it couldn't cover is charged by the pay type's absence table as before; and a
 * weekly day off inside a leave (Friday between Thursday and Saturday) is charged like the leave's other days.
 */
export function systemEntriesFor(
  day: AttendanceDay,
  employee: PayEmployee,
  rules: PayTypeRules,
  schedule: ScheduleTimes,
  kind: DayKind,
  leave: (LeaveForAbsence & { type: string; startTime?: string | null }) | null,
  charge?: DayCharge,
  /** the day's punches and approved timed permissions, for the exits in the middle of the day */
  midDay?: Omit<NonNullable<DayPayInput["midDay"]>, "corrected">,
): { deductions: SystemDeduction[]; additions: SystemAddition[] } {
  const deductions: SystemDeduction[] = [];
  const additions: SystemAddition[] = [];

  const chargeable = kind === "workday" || Boolean(charge?.sandwiched);
  const days = chargeable ? absenceDaysCharged(day.status, leave, day.scheduledStart, rules) : 0;
  if (days > 0) {
    // taken from the annual-leave balance: the day off is paid
    if (charge?.coveredByBalance) return { deductions, additions };
    const amount = Math.round(days * dayRate(rules, employee));
    if (amount > 0) {
      deductions.push({
        systemKey: systemKey(day.employeeId, day.date, "absence"),
        employeeId: day.employeeId,
        date: day.date,
        type: "absence",
        amount,
        reason: `${charge?.sandwiched ? "إجازة أسبوعية بين أيام الإجازة — " : ""}${
          days === rules.permittedAbsenceDays && leave ? `غياب بإذن معتمد مسبقاً — اليوم × ${fmt(days)}` : `غياب بدون إذن مسبق — اليوم × ${fmt(days)}`
        } (مفيش رصيد إجازة يغطيه)`,
      });
    }
    return { deductions, additions };
  }

  // a permission with a time is charged by its time (mid-day-exits.ts); only one without is for the rest of the day
  const hasPermission = leave?.type === "permission" && !leave.startTime;
  const pay = computeDayPay({
    date: day.date,
    kind,
    schedule,
    rules,
    pay: employee,
    actualIn: day.actualIn,
    actualOut: day.actualOut,
    hasPermission,
    midDay: midDay ? { ...midDay, corrected: day.corrected } : undefined,
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
        reason: reasonFor(item, pay, hasPermission),
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
        reason: reasonFor(item, pay, hasPermission),
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
  // The annual-leave balance is settled from 1 January of the first year in the window: every day of absence
  // since then takes from it in order, so the days in the window know whether the balance still covered them.
  const yearStart = new Date(`${firstDay.slice(0, 4)}-01-01T00:00:00.000Z`);
  const [days, employees, leaves, periods, existingDeductions, existingAdditions, ctx, absentRows, logs] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { date: range } }),
    prisma.employee.findMany({ where: { deletedAt: null } }),
    prisma.leave.findMany({ where: { status: "approved", to: { gte: yearStart }, from: { lte: range.lte } } }),
    prisma.payrollPeriod.findMany({ where: { status: { in: ["approved", "closed"] } } }),
    prisma.deduction.findMany({ where: { autoGenerated: true, systemKey: { not: null }, date: range } }),
    prisma.overtime.findMany({ where: { autoGenerated: true, systemKey: { not: null }, date: range } }),
    loadPayContext(),
    prisma.dailyAttendance.findMany({ where: { status: "absent", date: { gte: yearStart, lte: range.lte } }, select: { employeeId: true, status: true, date: true } }),
    // every punch the days' windows can reach (a window runs up to a few hours either side of the shift), for the
    // exits in the middle of the day
    prisma.attendanceLog.findMany({
      where: { timestamp: { gte: new Date(`${addDays(firstDay, -1)}T00:00:00`), lt: new Date(`${addDays(lastDay, 2)}T00:00:00`) } },
      select: { employeeId: true, timestamp: true, source: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  const isLocked = lockedDayCheck(periods, ctx);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const dayKindOf = (date: string) => kindOf(ctx, date);

  // employee|year -> what the balance made of each charged day
  const settled = new Map<string, Map<string, DayCharge>>();
  const chargeFor = (employeeId: string, date: string): DayCharge | undefined => {
    const year = Number(date.slice(0, 4));
    const key = `${employeeId}|${year}`;
    let charges = settled.get(key);
    if (!charges) {
      const employee = employeeById.get(employeeId)!;
      charges = leaveCharges({
        hireDate: dayStr(employee.hireDate),
        leaves: leaves
          .filter((l) => l.employeeId === employeeId)
          .map((l) => ({ type: l.type, status: l.status, from: dayStr(l.from), to: dayStr(l.to) })),
        absentDays: trackedAbsentDays(absentRows.filter((a) => a.employeeId === employeeId).map((a) => ({ status: a.status, date: dayStr(a.date) }))),
        year,
        upTo: lastDay,
        kindOf: dayKindOf,
      });
      settled.set(key, charges);
    }
    return charges.get(date);
  };

  const logsByEmployee = new Map<string, typeof logs>();
  for (const l of logs) {
    const list = logsByEmployee.get(l.employeeId);
    if (list) list.push(l);
    else logsByEmployee.set(l.employeeId, [l]);
  }

  const desiredDeductions: SystemDeduction[] = [];
  const desiredAdditions: SystemAddition[] = [];
  for (const d of days) {
    const date = dayStr(d.date);
    const employee = employeeById.get(d.employeeId);
    if (!employee || isLocked(date)) continue;
    const onDay = leaves.filter((l) => l.employeeId === d.employeeId && dayStr(l.from) <= date && dayStr(l.to) >= date);
    // a permission with a time isn't the day's leave: it is read against the punches (mid-day-exits.ts)
    const leave = onDay.find((l) => !isTimedPermission(l)) ?? null;
    const window = punchWindow(date, effectiveShift(ctx, employee, date));
    const entries = systemEntriesFor(
      { employeeId: d.employeeId, date, status: d.status, actualIn: d.actualIn, actualOut: d.actualOut, scheduledStart: d.scheduledStart, corrected: Boolean(d.correctionReason) },
      employee,
      rulesFor(ctx, employee),
      scheduleFor(ctx, employee),
      kindOf(ctx, date),
      leave,
      chargeFor(d.employeeId, date),
      {
        punches: (logsByEmployee.get(d.employeeId) ?? [])
          .filter((l) => l.timestamp >= window.gte && l.timestamp <= window.lte)
          .map((l) => ({ at: l.timestamp, source: l.source })),
        permissions: timedPermissions(onDay),
      },
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

/**
 * Who removed an addition because the employee's "له إضافي" was switched off. Stored in Overtime.voidedBy (in
 * Arabic, like the reasons the system writes), so switching it back on can tell these apart from an addition a
 * person removed by hand, which never comes back.
 */
export const OVERTIME_INELIGIBLE_VOIDED_BY = "النظام — له إضافي مقفول";

/** What the "له إضافي" switch reads off one of the employee's additions. */
export interface EligibilityOvertimeRow {
  id: string;
  /** yyyy-MM-dd */
  date: string;
  amount: number;
  autoGenerated: boolean;
  voidedAt: Date | string | null;
  voidedBy: string | null;
}

/**
 * "له إضافي" switched off: every addition still standing on a day that can still change — any kind, the
 * system's or entered by hand, edited or not, approved or pending. Days in an approved or closed pay month
 * (`isLocked`) keep exactly what they had.
 */
export function ineligibleOvertimeVoids<T extends EligibilityOvertimeRow>(rows: T[], isLocked: (day: string) => boolean): T[] {
  return rows.filter((r) => !r.voidedAt && !isLocked(r.date));
}

/**
 * "له إضافي" switched back on: the system's additions that were removed by switching it off, on days that can
 * still change, are handed back to the automatic posting to be worked out again. Entries made by hand, and
 * anything a person removed, stay removed.
 */
export function eligibleOvertimeRestores<T extends EligibilityOvertimeRow>(rows: T[], isLocked: (day: string) => boolean): T[] {
  return rows.filter((r) => r.autoGenerated && Boolean(r.voidedAt) && r.voidedBy === OVERTIME_INELIGIBLE_VOIDED_BY && !isLocked(r.date));
}

/** A day belongs to a pay month that is approved or closed: its pay must not change any more. */
export function lockedDayCheck(periods: { year: number; month: number }[], ctx: Pick<PayContext, "payPeriodStartDay">) {
  const locked = new Set(periods.map((p) => `${p.year}-${p.month}`));
  return (day: string) => {
    const p = payPeriodOf(day, ctx.payPeriodStartDay);
    return locked.has(`${p.year}-${p.month}`);
  };
}
