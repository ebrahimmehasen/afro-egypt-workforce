"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { getT } from "@/lib/i18n";
import { ActionState } from "@/hooks/use-action-feedback";

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return { from, to };
}

const openPeriodSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** Opens a new payroll period — one draft period per calendar month. */
export async function openPayrollPeriod(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = openPeriodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { year, month } = parsed.data;

  const existing = await prisma.payrollPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return { error: t.validation.periodExists };

  const period = await prisma.payrollPeriod.create({
    data: { label: `${MONTHS_AR[month - 1]} ${year}`, year, month, status: "draft" },
  });

  const user = await getSession();
  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.openPayrollPeriod,
    module: t.nav.payroll,
    oldValue: "-",
    newValue: period.label,
  });

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true, message: t.payroll.periodOpened };
}

export async function calculatePayroll(periodId: string) {
  const t = await getT();
  const user = await getSession();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status === "closed") return { error: t.validation.periodClosed };

  const { from, to } = monthRange(period.year, period.month);

  const [activeEmployees, settings, attSettings] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, status: { in: ["active", "on_leave"] } } }),
    prisma.payrollSettings.findUnique({ where: { id: "singleton" } }),
    prisma.attendanceSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  if (!settings || !attSettings) return { error: t.validation.invalidData };

  await prisma.$transaction(async (tx) => {
    await tx.payrollRecord.deleteMany({ where: { periodId } });

    for (const employee of activeEmployees) {
      const [monthAttendance, empAllowances, approvedOvertime, manualDeductions] = await Promise.all([
        tx.dailyAttendance.findMany({ where: { employeeId: employee.id, date: { gte: from, lt: to } } }),
        tx.allowance.findMany({ where: { employeeId: employee.id } }),
        tx.overtime.findMany({ where: { employeeId: employee.id, status: "approved", date: { gte: from, lt: to } } }),
        tx.deduction.findMany({
          where: {
            employeeId: employee.id,
            date: { gte: from, lt: to },
            type: { in: ["penalty", "advance", "admin_deduction", "other"] },
          },
        }),
      ]);

      const lateMinutesTotal = monthAttendance.reduce((s, a) => s + a.deductibleLateMinutes, 0);
      const absenceDays = monthAttendance.filter((a) => a.status === "absent").length;
      const earlyLeaveMinutesTotal = monthAttendance.reduce((s, a) => s + a.earlyLeaveMinutes, 0);

      const allowancesTotal = empAllowances
        .filter((a) => a.type === "transport" || a.type === "meal" || a.type === "fixed")
        .reduce((s, a) => s + a.amount, 0);
      const incentives = empAllowances.filter((a) => a.type === "incentive").reduce((s, a) => s + a.amount, 0);
      const bonuses = empAllowances.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
      const approvedOvertimeAmount = approvedOvertime.reduce((s, o) => s + o.amount, 0);

      const result = calculatePayrollRecord(periodId, {
        employee: {
          id: employee.id,
          name: employee.name,
          departmentId: employee.departmentId,
          jobTitle: employee.jobTitle,
          hireDate: employee.hireDate.toISOString().slice(0, 10),
          shiftId: employee.shiftId,
          basicSalary: employee.basicSalary,
          allowances: employee.allowancesTotal,
          biometricDeviceUserId: employee.biometricDeviceUserId,
          status: employee.status,
        },
        allowancesTotal,
        approvedOvertimeAmount,
        incentives,
        bonuses,
        lateMinutesTotal,
        absenceDays,
        earlyLeaveMinutesTotal,
        deductions: manualDeductions.map((d) => ({
          id: d.id,
          employeeId: d.employeeId,
          type: d.type,
          amount: d.amount,
          date: d.date.toISOString().slice(0, 10),
          reason: d.reason,
          createdAt: d.createdAt.toISOString(),
        })),
        settings: {
          ...settings,
          lateDeductionPerMinute: attSettings.lateDeductionPerMinute,
          earlyLeaveDeductionPerMinute: attSettings.earlyLeaveDeductionPerMinute,
        },
      });

      await tx.payrollRecord.create({ data: { ...result, periodId, employeeId: employee.id } });
    }

    await tx.payrollPeriod.update({
      where: { id: periodId },
      data: { status: "calculated", calculatedAt: new Date() },
    });
  });

  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.calculatePayroll,
    module: t.nav.payroll,
    oldValue: t.payrollPeriodStatus.draft,
    newValue: `${t.payrollPeriodStatus.calculated} — ${activeEmployees.length} ${t.common.employee}`,
    reason: period.label,
  });

  revalidatePath("/payroll");
  revalidatePath("/dashboard");
  revalidatePath("/workforce-cost");
  revalidatePath("/audit-log");
  return { success: true };
}

export async function approvePayrollPeriod(periodId: string) {
  const t = await getT();
  const user = await getSession();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "calculated") return { error: t.validation.payrollNotCalculatedFirst };

  await prisma.payrollPeriod.update({
    where: { id: periodId },
    data: { status: "approved", approvedAt: new Date() },
  });

  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.approvePayroll,
    module: t.nav.payroll,
    oldValue: t.payrollPeriodStatus.calculated,
    newValue: t.payrollPeriodStatus.approved,
    reason: period.label,
  });

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true };
}

export async function closePayrollPeriod(periodId: string) {
  const t = await getT();
  const user = await getSession();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "approved") return { error: t.validation.payrollApprovedFirst };

  await prisma.payrollPeriod.update({
    where: { id: periodId },
    data: { status: "closed", closedAt: new Date() },
  });

  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.closePayrollPeriod,
    module: t.nav.payroll,
    oldValue: t.payrollPeriodStatus.approved,
    newValue: t.payrollPeriodStatus.closed,
    reason: period.label,
  });

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true };
}
