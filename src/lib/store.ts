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
