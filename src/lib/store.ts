import {
  Allowance,
  AttendanceLog,
  AuditLogEntry,
  AttendanceSettings,
  CompanySettings,
  DailyAttendance,
  Deduction,
  Department,
  Employee,
  Leave,
  Overtime,
  PayrollPeriod,
  PayrollRecord,
  PayrollSettings,
  Shift,
} from "@/lib/types";
import { prisma } from "@/lib/prisma";

/** Read-model snapshot shape. Hydrated from the database by `getDb()` in @/lib/data. */
export interface Store {
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  attendanceLogs: AttendanceLog[]; // immutable raw punches
  dailyAttendance: DailyAttendance[]; // calculated, correctable
  leaves: Leave[];
  overtime: Overtime[];
  deductions: Deduction[];
  allowances: Allowance[];
  payrollPeriods: PayrollPeriod[];
  payrollRecords: PayrollRecord[];
  auditLog: AuditLogEntry[];
  companySettings: CompanySettings;
  attendanceSettings: AttendanceSettings;
  payrollSettings: PayrollSettings;
}

/** Appends an audit-log row. Call inside the same transaction as the change it records where possible. */
export async function addAuditLog(entry: Omit<AuditLogEntry, "id" | "timestamp">) {
  await prisma.auditLogEntry.create({
    data: {
      userName: entry.userName,
      action: entry.action,
      module: entry.module,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      reason: entry.reason,
    },
  });
}
