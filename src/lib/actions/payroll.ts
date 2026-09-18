"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs, writeAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
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

type OpenPeriodPayload = z.infer<typeof openPeriodSchema>;

/** Opens a new payroll period — one draft period per calendar month. */
export async function openPayrollPeriod(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = openPeriodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { year, month } = parsed.data;

  const existing = await prisma.payrollPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return { error: t.validation.periodExists };

  const actor = await getSession();
  return gate(
    {
      actionKey: "payroll.openPeriod",
      module: t.nav.payroll,
      actionLabel: t.auditActions.openPayrollPeriod,
      summary: `${MONTHS_AR[month - 1]} ${year}`,
    },
    parsed.data,
    () => applyOpenPayrollPeriod(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyOpenPayrollPeriod(payload: OpenPeriodPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { year, month } = payload;
  const existing = await prisma.payrollPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return { error: t.validation.periodExists };

  const label = `${MONTHS_AR[month - 1]} ${year}`;
  await recordChangeAs(
    actorName,
    { module: t.nav.payroll, action: t.auditActions.openPayrollPeriod, newValue: label },
    (tx) => tx.payrollPeriod.create({ data: { label, year, month, status: "draft" } }),
  );

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true, message: t.payroll.periodOpened };
}

type CalculatePayrollPayload = { periodId: string };

export async function calculatePayroll(periodId: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status === "closed") return { error: t.validation.periodClosed };
  const actor = await getSession();

  return gate(
    {
      actionKey: "payroll.calculate",
      module: t.nav.payroll,
      actionLabel: t.auditActions.calculatePayroll,
      summary: period.label,
      targetId: periodId,
    },
    { periodId } satisfies CalculatePayrollPayload,
    () => applyCalculatePayroll({ periodId }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCalculatePayroll(payload: CalculatePayrollPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { periodId } = payload;
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
      // A daily worker gets paid for any day they showed up — a single punch
      // (missing_punch) counts as a full paid day for them (spec §1.2).
      const PAID_STATUSES = ["present", "late", "early_leave", "missing_punch"];
      const paidDays = monthAttendance.filter((a) => PAID_STATUSES.includes(a.status)).length;

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
          salaryType: employee.salaryType,
          basicSalary: employee.basicSalary,
          dailyRate: employee.dailyRate ?? undefined,
          dailyWorkingHours: employee.dailyWorkingHours,
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
        paidDays,
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

    await writeAudit(
      tx,
      {
        module: t.nav.payroll,
        action: t.auditActions.calculatePayroll,
        oldValue: t.payrollPeriodStatus.draft,
        newValue: `${t.payrollPeriodStatus.calculated} — ${activeEmployees.length} ${t.common.employee}`,
        reason: period.label,
      },
      actorName,
    );
  });

  revalidatePath("/payroll");
  revalidatePath("/dashboard");
  revalidatePath("/workforce-cost");
  revalidatePath("/audit-log");
  return { success: true };
}

type PeriodIdPayload = { periodId: string };

export async function approvePayrollPeriod(periodId: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "calculated") return { error: t.validation.payrollNotCalculatedFirst };
  const actor = await getSession();

  return gate(
    {
      actionKey: "payroll.approve",
      module: t.nav.payroll,
      actionLabel: t.auditActions.approvePayroll,
      summary: period.label,
      targetId: periodId,
    },
    { periodId } satisfies PeriodIdPayload,
    () => applyApprovePayrollPeriod({ periodId }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyApprovePayrollPeriod(payload: PeriodIdPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: payload.periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "calculated") return { error: t.validation.payrollNotCalculatedFirst };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.payroll,
      action: t.auditActions.approvePayroll,
      oldValue: t.payrollPeriodStatus.calculated,
      newValue: t.payrollPeriodStatus.approved,
      reason: period.label,
    },
    (tx) => tx.payrollPeriod.update({ where: { id: payload.periodId }, data: { status: "approved", approvedAt: new Date() } }),
  );

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true };
}

export async function closePayrollPeriod(periodId: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "approved") return { error: t.validation.payrollApprovedFirst };
  const actor = await getSession();

  return gate(
    {
      actionKey: "payroll.close",
      module: t.nav.payroll,
      actionLabel: t.auditActions.closePayrollPeriod,
      summary: period.label,
      targetId: periodId,
    },
    { periodId } satisfies PeriodIdPayload,
    () => applyClosePayrollPeriod({ periodId }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyClosePayrollPeriod(payload: PeriodIdPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: payload.periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "approved") return { error: t.validation.payrollApprovedFirst };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.payroll,
      action: t.auditActions.closePayrollPeriod,
      oldValue: t.payrollPeriodStatus.approved,
      newValue: t.payrollPeriodStatus.closed,
      reason: period.label,
    },
    (tx) => tx.payrollPeriod.update({ where: { id: payload.periodId }, data: { status: "closed", closedAt: new Date() } }),
  );

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true };
}
