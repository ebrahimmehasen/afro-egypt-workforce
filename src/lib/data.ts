import { prisma } from "@/lib/prisma";
import { Store } from "@/lib/store";
import {
  toAllowance,
  toAttendanceLog,
  toAuditLogEntry,
  toDailyAttendance,
  toDeduction,
  toDepartment,
  toEmployee,
  toLeave,
  toOvertime,
  toPayrollPeriod,
  toPayrollRecord,
  toShift,
} from "@/lib/serialize";

const DEFAULT_COMPANY_SETTINGS = {
  companyName: "Afro Egypt",
  logoUrl: "/brand/afro-egypt-logo.jpg",
  address: "المنطقة الصناعية، القاهرة، مصر",
  phone: "+20 2 0000 0000",
};
const DEFAULT_ATTENDANCE_SETTINGS = {
  defaultGracePeriodMinutes: 10,
  lateDeductionPerMinute: 5,
  earlyLeaveDeductionPerMinute: 5,
  absenceDeductionDays: 1,
};
const DEFAULT_PAYROLL_SETTINGS = {
  overtimeHourlyMultiplier: 1.5,
  workingDaysPerMonth: 26,
  workingHoursPerDay: 8,
};

/**
 * Loads a full read-model snapshot from the database in the shape the pages,
 * selectors and pure engines expect. Soft-deleted employees / departments /
 * shifts are excluded. Single factory scale — a handful of `findMany`s per
 * request is fine; optimise hot paths later if needed.
 */
export async function getDb(): Promise<Store> {
  const [
    employees,
    departments,
    shifts,
    attendanceLogs,
    dailyAttendance,
    leaves,
    overtime,
    deductions,
    allowances,
    payrollPeriods,
    payrollRecords,
    auditLog,
    companySettings,
    attendanceSettings,
    payrollSettings,
  ] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" } }),
    prisma.department.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" } }),
    prisma.shift.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" } }),
    prisma.attendanceLog.findMany({ orderBy: { timestamp: "asc" } }),
    prisma.dailyAttendance.findMany({ orderBy: { date: "asc" } }),
    prisma.leave.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.overtime.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.deduction.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.allowance.findMany(),
    prisma.payrollPeriod.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] }),
    prisma.payrollRecord.findMany(),
    prisma.auditLogEntry.findMany({ orderBy: { timestamp: "desc" } }),
    prisma.companySettings.findUnique({ where: { id: "singleton" } }),
    prisma.attendanceSettings.findUnique({ where: { id: "singleton" } }),
    prisma.payrollSettings.findUnique({ where: { id: "singleton" } }),
  ]);

  return {
    employees: employees.map(toEmployee),
    departments: departments.map(toDepartment),
    shifts: shifts.map(toShift),
    attendanceLogs: attendanceLogs.map(toAttendanceLog),
    dailyAttendance: dailyAttendance.map(toDailyAttendance),
    leaves: leaves.map(toLeave),
    overtime: overtime.map(toOvertime),
    deductions: deductions.map(toDeduction),
    allowances: allowances.map(toAllowance),
    payrollPeriods: payrollPeriods.map(toPayrollPeriod),
    payrollRecords: payrollRecords.map(toPayrollRecord),
    auditLog: auditLog.map(toAuditLogEntry),
    companySettings: companySettings
      ? {
          companyName: companySettings.companyName,
          logoUrl: companySettings.logoUrl,
          address: companySettings.address,
          phone: companySettings.phone,
        }
      : DEFAULT_COMPANY_SETTINGS,
    attendanceSettings: attendanceSettings
      ? {
          defaultGracePeriodMinutes: attendanceSettings.defaultGracePeriodMinutes,
          lateDeductionPerMinute: attendanceSettings.lateDeductionPerMinute,
          earlyLeaveDeductionPerMinute: attendanceSettings.earlyLeaveDeductionPerMinute,
          absenceDeductionDays: attendanceSettings.absenceDeductionDays,
        }
      : DEFAULT_ATTENDANCE_SETTINGS,
    payrollSettings: payrollSettings
      ? {
          overtimeHourlyMultiplier: payrollSettings.overtimeHourlyMultiplier,
          workingDaysPerMonth: payrollSettings.workingDaysPerMonth,
          workingHoursPerDay: payrollSettings.workingHoursPerDay,
        }
      : DEFAULT_PAYROLL_SETTINGS,
  };
}
