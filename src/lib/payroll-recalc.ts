import { prisma } from "@/lib/prisma";
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

/** The pay month as a half-open date range for queries: from its start day in the month before, up to (not
 * including) that day in this one. The start day comes from the payroll settings. */
export function payMonthRange(year: number, month: number, startDay: number) {
  const { from, to } = payPeriodRange(year, month, startDay);
  return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${addDays(to, 1)}T00:00:00.000Z`) };
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
  const { from, to } = payMonthRange(period.year, period.month, ctx.payPeriodStartDay);

  const activeEmployees = await prisma.employee.findMany({ where: { deletedAt: null, status: { in: ["active", "on_leave"] } } });

  return prisma.$transaction(async (tx) => {
    // re-read inside the transaction: the guard must see the status as it is now
    const current = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!current || current.status === "closed") return "closed";
    if (opts.onlyIf && !opts.onlyIf.includes(current.status as "draft" | "calculated" | "approved")) return "skipped";

    await tx.payrollRecord.deleteMany({ where: { periodId } });

    for (const employee of activeEmployees) {
      const [monthAttendance, empAllowances, approvedOvertime, periodDeductions] = await Promise.all([
        tx.dailyAttendance.findMany({ where: { employeeId: employee.id, date: { gte: from, lt: to } } }),
        tx.allowance.findMany({
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
        tx.overtime.findMany({ where: { employeeId: employee.id, status: "approved", voidedAt: null, date: { gte: from, lt: to } } }),
        // every deduction of the month, the system's (absence, lateness, early leave) and the manual ones;
        // a system deduction someone removed no longer counts
        tx.deduction.findMany({ where: { employeeId: employee.id, date: { gte: from, lt: to }, voidedAt: null } }),
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

      await tx.payrollRecord.create({ data: { ...result, periodId, employeeId: employee.id } });
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
