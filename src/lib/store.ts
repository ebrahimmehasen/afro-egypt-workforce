import {
  Allowance,
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

/**
 * Read-model snapshot shape, hydrated from the database by `getDb()` in
 * @/lib/data. Deliberately excludes the two unbounded append-only tables —
 * raw `AttendanceLog` punches and the `AuditLogEntry` trail: their single
 * consumers (the attendance and audit-log pages) query them directly, with a
 * date / row bound, so the snapshot cost does not grow with history.
 */
export interface Store {
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  dailyAttendance: DailyAttendance[]; // calculated, correctable
  leaves: Leave[];
  overtime: Overtime[];
  deductions: Deduction[];
  allowances: Allowance[];
  payrollPeriods: PayrollPeriod[];
  payrollRecords: PayrollRecord[];
  companySettings: CompanySettings;
  attendanceSettings: AttendanceSettings;
  payrollSettings: PayrollSettings;
}
