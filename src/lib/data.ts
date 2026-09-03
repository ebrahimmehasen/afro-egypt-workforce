import { prisma } from "@/lib/prisma";
import { Store } from "@/lib/store";
import { AttendanceLog, AuditLogEntry } from "@/lib/types";
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
    dailyAttendance,
    leaves,
    overtime,
    deductions,
    allowances,
    payrollPeriods,
    payrollRecords,
    companySettings,
    attendanceSettings,
    payrollSettings,
  ] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" } }),
    prisma.department.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" } }),
    prisma.shift.findMany({ where: { deletedAt: null }, orderBy: { id: "asc" } }),
    prisma.dailyAttendance.findMany({ orderBy: { date: "asc" } }),
    prisma.leave.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.overtime.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.deduction.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.allowance.findMany(),
    prisma.payrollPeriod.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] }),
    prisma.payrollRecord.findMany(),
    prisma.companySettings.findUnique({ where: { id: "singleton" } }),
    prisma.attendanceSettings.findUnique({ where: { id: "singleton" } }),
    prisma.payrollSettings.findUnique({ where: { id: "singleton" } }),
  ]);

  return {
    employees: employees.map(toEmployee),
    departments: departments.map(toDepartment),
    shifts: shifts.map(toShift),
    dailyAttendance: dailyAttendance.map(toDailyAttendance),
    leaves: leaves.map(toLeave),
    overtime: overtime.map(toOvertime),
    deductions: deductions.map(toDeduction),
    allowances: allowances.map(toAllowance),
    payrollPeriods: payrollPeriods.map(toPayrollPeriod),
    payrollRecords: payrollRecords.map(toPayrollRecord),
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

/**
 * Raw punches whose timestamp falls on the given UTC calendar day, optionally
 * narrowed to a set of employees. Kept out of `getDb()` — this table is
 * append-only and unbounded, so it is always read with a date bound.
 */
export async function getAttendanceLogsForDate(
  date: string,
  employeeIds?: Iterable<string>,
): Promise<AttendanceLog[]> {
  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  const ids = employeeIds ? [...employeeIds] : undefined;

  const rows = await prisma.attendanceLog.findMany({
    where: {
      timestamp: { gte: from, lt: to },
      ...(ids ? { employeeId: { in: ids } } : {}),
    },
    orderBy: { timestamp: "asc" },
  });
  return rows.map(toAttendanceLog);
}

/** Most recent audit-log entries, newest first. Bounded — the full trail is never loaded at once. */
export async function getAuditLog(limit = 200): Promise<AuditLogEntry[]> {
  const rows = await prisma.auditLogEntry.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  return rows.map(toAuditLogEntry);
}
