import { prisma, TransactionClient } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { dailyPaidDays, payPeriodRange } from "@/lib/pay-rules";
import { dayRate } from "@/lib/pay-engine";
import { kindOf, loadPayContext, rulesFor } from "@/lib/pay-context";
import { ABSENCE_TRACKING_FROM } from "@/lib/attendance-engine";
import { dayStr } from "@/lib/serialize";
import { addDays } from "@/lib/today";
import { getDictionary } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { AllowanceType, DeductionType } from "@/lib/types";

/** The pay month as a half-open date range for queries: from its start day in the month before, up to (not
 * including) that day in this one. The start day comes from the payroll settings. */
export function payMonthRange(year: number, month: number, startDay: number) {
  const { from, to } = payPeriodRange(year, month, startDay);
  return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${addDays(to, 1)}T00:00:00.000Z`) };
}

type PeriodDb = typeof prisma | TransactionClient;

/** Computes one employee's payroll figures for the period from what is on file now, without writing anything. */
async function computeEmployeeRecord(
  db: PeriodDb,
  periodId: string,
  period: { year: number; month: number },
  ctx: Awaited<ReturnType<typeof loadPayContext>>,
  employee: Awaited<ReturnType<typeof prisma.employee.findMany>>[number],
) {
  const { from, to } = payMonthRange(period.year, period.month, ctx.payPeriodStartDay);
  const [monthAttendance, empAllowances, approvedOvertime, periodDeductions] = await Promise.all([
    db.dailyAttendance.findMany({ where: { employeeId: employee.id, date: { gte: from, lt: to } } }),
    db.allowance.findMany({
      where: {
        employeeId: employee.id,
        // recurring allowances always apply; a one-off bonus only in its own month
        OR: [
          { monthly: true },
          { monthly: false, effectiveYear: period.year, effectiveMonth: period.month },
        ],
      },
    }),
    // approved additions: overtime and weekly-day-off / holiday / Thursday work; a removed system one no longer counts
    db.overtime.findMany({ where: { employeeId: employee.id, status: "approved", voidedAt: null, date: { gte: from, lt: to } } }),
    // every deduction of the month, the system's (absence, lateness, early leave) and the manual ones;
    // a system deduction someone removed no longer counts
    db.deduction.findMany({ where: { employeeId: employee.id, date: { gte: from, lt: to }, voidedAt: null } }),
  ]);

  const rules = rulesFor(ctx, employee);
  const paidDays = dailyPaidDays(
    monthAttendance.map((a) => ({ date: dayStr(a.date), status: a.status })),
    ABSENCE_TRACKING_FROM,
    (date) => kindOf(ctx, date) !== "workday",
  );

  const allowancesTotal = empAllowances
    .filter((a) => a.type === "transport" || a.type === "meal" || a.type === "fixed")
    .reduce((s, a) => s + a.amount, 0);
  const incentives = empAllowances.filter((a) => a.type === "incentive").reduce((s, a) => s + a.amount, 0);
  const bonuses = empAllowances.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
  const approvedOvertimeAmount = approvedOvertime.reduce((s, o) => s + o.amount, 0);

  const result = calculatePayrollRecord(periodId, {
    employee: {
      id: employee.id,
      employeeNumber: employee.employeeNumber,
      name: employee.name,
      departmentId: employee.departmentId,
      jobTitle: employee.jobTitle,
      hireDate: employee.hireDate.toISOString().slice(0, 10),
      shiftId: employee.shiftId,
      salaryType: rules.basis,
      basicSalary: employee.basicSalary,
      dailyRate: employee.dailyRate ?? undefined,
      dailyWorkingHours: employee.dailyWorkingHours,
      allowances: employee.allowancesTotal,
      biometricDeviceUserId: employee.biometricDeviceUserId ?? undefined,
      status: employee.status,
    },
    allowancesTotal,
    approvedOvertimeAmount,
    incentives,
    bonuses,
    dayRate: dayRate(rules, employee),
    paidDays,
    deductions: periodDeductions.map((d) => ({
      id: d.id,
      employeeId: d.employeeId,
      type: d.type,
      amount: d.amount,
      date: d.date.toISOString().slice(0, 10),
      reason: d.reason,
      createdAt: d.createdAt.toISOString(),
    })),
  });

  return { ...result, employeeId: employee.id };
}

/**
 * (Re)builds every PayrollRecord of one period from what is on file now — attendance, allowances, approved
 * additions and the month's deductions — and marks the period "calculated". The same calculation the
 * "حساب الرواتب" button runs; it needs no request (no cookies, no session), so the background refresh can run it
 * too. `onlyIf` guards the write inside the transaction: the period is left alone unless its status is still one
 * of those (so an approval that lands meanwhile is never overwritten).
 */
export async function calculatePeriodRecords(
  periodId: string,
  actorName: string,
  t: Dictionary,
  opts: { onlyIf?: ("draft" | "calculated" | "approved")[]; audit?: { action: string; oldValue: string } } = {},
): Promise<"done" | "not_found" | "closed" | "skipped"> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return "not_found";
  if (period.status === "closed") return "closed";

  // every rule comes from settings: the pay month's start day, each employee's pay type, the days off
  const ctx = await loadPayContext();
  const activeEmployees = await prisma.employee.findMany({ where: { deletedAt: null, status: { in: ["active", "on_leave"] } } });

  return prisma.$transaction(async (tx) => {
    // re-read inside the transaction: the guard must see the status as it is now
    const current = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!current || current.status === "closed") return "closed";
    if (opts.onlyIf && !opts.onlyIf.includes(current.status as "draft" | "calculated" | "approved")) return "skipped";

    await tx.payrollRecord.deleteMany({ where: { periodId } });

    for (const employee of activeEmployees) {
      const result = await computeEmployeeRecord(tx, periodId, period, ctx, employee);
      await tx.payrollRecord.create({ data: { ...result, periodId } });
    }

    await tx.payrollPeriod.update({
      where: { id: periodId },
      data: { status: "calculated", calculatedAt: new Date() },
    });

    await writeAudit(
      tx,
      {
        module: t.nav.payroll,
        action: opts.audit?.action ?? t.auditActions.calculatePayroll,
        oldValue: opts.audit?.oldValue ?? t.payrollPeriodStatus.draft,
        newValue: `${t.payrollPeriodStatus.calculated} — ${activeEmployees.length} ${t.common.employee}`,
        reason: period.label,
      },
      actorName,
    );
    return "done";
  });
}

/**
 * Brings every payroll period that is calculated but not yet approved up to date with what is on file now, so a
 * deduction posted (or changed) after someone pressed "حساب الرواتب" reaches the payslips without pressing it
 * again. Approved and closed periods are never touched; a draft one has no records to refresh yet. Signed by
 * the system. Returns how many periods were recalculated.
 */
export async function recalculateOpenPayrollPeriods(): Promise<number> {
  const t = getDictionary("ar");
  const open = await prisma.payrollPeriod.findMany({ where: { status: "calculated" }, select: { id: true } });
  let done = 0;
  for (const p of open) {
    const r = await calculatePeriodRecords(p.id, t.auditActions.system, t, {
      onlyIf: ["calculated"],
      audit: { action: t.auditActions.autoRecalculatePayroll, oldValue: t.payrollPeriodStatus.calculated },
    });
    if (r === "done") done++;
  }
  return done;
}

export type RecalculationReason =
  | { source: "deduction"; action: "created" | "edited" | "voided"; type: DeductionType; amount: number; oldAmount?: number; date: string; at: string; actorName?: string }
  | { source: "overtime"; action: "created" | "voided"; kind: string; amount: number; date: string; at: string; actorName?: string }
  | { source: "allowance"; action: "created"; type: AllowanceType; amount: number; date: string; at: string; actorName?: string }
  | { source: "generic" };

export type RecalculationChange = {
  employeeId: string;
  employeeNumber: string;
  name: string;
  oldNetSalary: number;
  newNetSalary: number;
  reasons: RecalculationReason[];
};

/** The one audit entry, if any, that clearly explains a row change at `at`: the only entry of a matching module
 * within a few seconds of it. More than one candidate (or none) is not a clear match, so the name is left out
 * rather than guessed. */
async function findActorName(moduleCandidates: string[], at: Date): Promise<string | undefined> {
  const toleranceMs = 3000;
  const entries = await prisma.auditLogEntry.findMany({
    where: { module: { in: moduleCandidates }, timestamp: { gte: new Date(at.getTime() - toleranceMs), lte: new Date(at.getTime() + toleranceMs) } },
  });
  return entries.length === 1 ? entries[0].userName : undefined;
}

/** Every deduction, overtime and allowance change for one employee, in this pay month, that happened after the
 * period was approved — the real rows behind a changed net salary. */
async function employeeReasons(employeeId: string, approvedAt: Date, from: Date, to: Date, period: { year: number; month: number }): Promise<RecalculationReason[]> {
  const ar = getDictionary("ar");
  const en = getDictionary("en");
  const deductionModules = [ar.nav.deductions, en.nav.deductions];
  const overtimeModules = [ar.nav.overtime, en.nav.overtime];

  const [deductions, overtimes, allowances] = await Promise.all([
    prisma.deduction.findMany({ where: { employeeId, date: { gte: from, lt: to } } }),
    prisma.overtime.findMany({ where: { employeeId, date: { gte: from, lt: to } } }),
    prisma.allowance.findMany({
      where: { employeeId, OR: [{ monthly: true }, { monthly: false, effectiveYear: period.year, effectiveMonth: period.month }] },
    }),
  ]);

  const reasons: RecalculationReason[] = [];
  for (const d of deductions) {
    if (d.voidedAt && d.voidedAt > approvedAt) {
      reasons.push({ source: "deduction", action: "voided", type: d.type, amount: d.amount, date: dayStr(d.date), at: d.voidedAt.toISOString(), actorName: await findActorName(deductionModules, d.voidedAt) });
    } else if (d.editedAt && d.editedAt > approvedAt) {
      reasons.push({
        source: "deduction", action: "edited", type: d.type, amount: d.amount, oldAmount: d.originalAmount ?? undefined,
        date: dayStr(d.date), at: d.editedAt.toISOString(), actorName: await findActorName(deductionModules, d.editedAt),
      });
    } else if (d.createdAt > approvedAt) {
      reasons.push({ source: "deduction", action: "created", type: d.type, amount: d.amount, date: dayStr(d.date), at: d.createdAt.toISOString(), actorName: await findActorName(deductionModules, d.createdAt) });
    }
  }
  for (const o of overtimes) {
    if (o.voidedAt && o.voidedAt > approvedAt) {
      reasons.push({ source: "overtime", action: "voided", kind: o.kind, amount: o.amount, date: dayStr(o.date), at: o.voidedAt.toISOString(), actorName: await findActorName(overtimeModules, o.voidedAt) });
    } else if (o.status === "approved" && !o.voidedAt && o.createdAt > approvedAt) {
      reasons.push({ source: "overtime", action: "created", kind: o.kind, amount: o.amount, date: dayStr(o.date), at: o.createdAt.toISOString(), actorName: await findActorName(overtimeModules, o.createdAt) });
    }
  }
  for (const a of allowances) {
    if (a.createdAt > approvedAt) {
      reasons.push({ source: "allowance", action: "created", type: a.type, amount: a.amount, date: dayStr(a.createdAt), at: a.createdAt.toISOString(), actorName: await findActorName(deductionModules, a.createdAt) });
    }
  }
  return reasons;
}

/**
 * What recalculating this period would change, without writing anything — the net salary this period has on file
 * now vs. what it would become from today's attendance, allowances and deductions, and the deduction / overtime /
 * allowance rows (who, when, how much) behind each employee's change since the period was approved. Only
 * employees whose figure would actually change are returned. Used to show an approved period's admin the real
 * impact before they confirm a recalculation (closed periods never recalculate, so this is never called for one).
 */
export async function previewRecalculation(periodId: string): Promise<RecalculationChange[]> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return [];

  const ctx = await loadPayContext();
  const { from, to } = payMonthRange(period.year, period.month, ctx.payPeriodStartDay);
  const [activeEmployees, existingRecords] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, status: { in: ["active", "on_leave"] } } }),
    prisma.payrollRecord.findMany({ where: { periodId } }),
  ]);
  const existingByEmployee = new Map(existingRecords.map((r) => [r.employeeId, r]));

  const changes: RecalculationChange[] = [];
  for (const employee of activeEmployees) {
    const result = await computeEmployeeRecord(prisma, periodId, period, ctx, employee);
    const existing = existingByEmployee.get(employee.id);
    const oldNetSalary = existing?.netSalary ?? 0;
    if (oldNetSalary !== result.netSalary) {
      const reasons = period.approvedAt ? await employeeReasons(employee.id, period.approvedAt, from, to, period) : [];
      changes.push({
        employeeId: employee.id, employeeNumber: employee.employeeNumber, name: employee.name, oldNetSalary, newNetSalary: result.netSalary,
        reasons: reasons.length > 0 ? reasons : [{ source: "generic" }],
      });
    }
  }
  return changes;
}
