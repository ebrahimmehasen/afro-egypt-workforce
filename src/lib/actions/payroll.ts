"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/data";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { nextId } from "@/lib/id";
import { getT } from "@/lib/i18n";

export async function calculatePayroll(periodId: string) {
  const t = await getT();
  const db = getDb();
  const user = await getSession();
  const period = db.payrollPeriods.find((p) => p.id === periodId);
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status === "closed") return { error: t.validation.periodClosed };

  const prefix = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const activeEmployees = db.employees.filter((e) => e.status === "active" || e.status === "on_leave");

  // Drop any previous records for this period before recalculating
  db.payrollRecords = db.payrollRecords.filter((r) => r.periodId !== periodId);

  for (const employee of activeEmployees) {
    const monthAttendance = db.dailyAttendance.filter(
      (a) => a.employeeId === employee.id && a.date.startsWith(prefix),
    );
    const lateMinutesTotal = monthAttendance.reduce((sum, a) => sum + a.deductibleLateMinutes, 0);
    const absenceDays = monthAttendance.filter((a) => a.status === "absent").length;
    const earlyLeaveMinutesTotal = monthAttendance.reduce((sum, a) => sum + a.earlyLeaveMinutes, 0);

    const empAllowances = db.allowances.filter((a) => a.employeeId === employee.id);
    const allowancesTotal = empAllowances
      .filter((a) => a.type === "transport" || a.type === "meal" || a.type === "fixed")
      .reduce((sum, a) => sum + a.amount, 0);
    const incentives = empAllowances.filter((a) => a.type === "incentive").reduce((s, a) => s + a.amount, 0);
    const bonuses = empAllowances.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);

    const approvedOvertimeAmount = db.overtime
      .filter((o) => o.employeeId === employee.id && o.date.startsWith(prefix) && o.status === "approved")
      .reduce((sum, o) => sum + o.amount, 0);

    const manualDeductions = db.deductions.filter(
      (d) =>
        d.employeeId === employee.id &&
        d.date.startsWith(prefix) &&
        ["penalty", "advance", "admin_deduction", "other"].includes(d.type),
    );

    const result = calculatePayrollRecord(periodId, {
      employee,
      allowancesTotal,
      approvedOvertimeAmount,
      incentives,
      bonuses,
      lateMinutesTotal,
      absenceDays,
      earlyLeaveMinutesTotal,
      deductions: manualDeductions,
      settings: {
        ...db.payrollSettings,
        lateDeductionPerMinute: db.attendanceSettings.lateDeductionPerMinute,
        earlyLeaveDeductionPerMinute: db.attendanceSettings.earlyLeaveDeductionPerMinute,
      },
    });

    db.payrollRecords.push({ id: nextId("PR"), ...result });
  }

  period.status = "calculated";
  period.calculatedAt = new Date().toISOString();

  addAuditLog({
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
  const db = getDb();
  const user = await getSession();
  const period = db.payrollPeriods.find((p) => p.id === periodId);
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "calculated") return { error: t.validation.payrollNotCalculatedFirst };

  period.status = "approved";
  period.approvedAt = new Date().toISOString();

  addAuditLog({
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
  const db = getDb();
  const user = await getSession();
  const period = db.payrollPeriods.find((p) => p.id === periodId);
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "approved") return { error: t.validation.payrollApprovedFirst };

  period.status = "closed";
  period.closedAt = new Date().toISOString();

  addAuditLog({
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
