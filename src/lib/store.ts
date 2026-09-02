import {
  AllowanceType,
  AttendanceLog,
  AuditLogEntry,
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
  seeded: boolean;
}

function emptyStore(): Store {
  return {
    employees: [],
    departments: [],
    shifts: [],
    attendanceLogs: [],
    dailyAttendance: [],
    leaves: [],
    overtime: [],
    deductions: [],
    allowances: [],
    payrollPeriods: [],
    payrollRecords: [],
    auditLog: [],
    companySettings: {
      companyName: "Afro Egypt",
      logoUrl: "/brand/afro-egypt-logo.jpg",
      address: "المنطقة الصناعية، القاهرة، مصر",
      phone: "+20 2 0000 0000",
    },
    attendanceSettings: {
      defaultGracePeriodMinutes: 10,
      lateDeductionPerMinute: 5,
      earlyLeaveDeductionPerMinute: 5,
      absenceDeductionDays: 1,
    },
    payrollSettings: {
      overtimeHourlyMultiplier: 1.5,
      workingDaysPerMonth: 26,
      workingHoursPerDay: 8,
    },
    seeded: false,
  };
}

// Attach to globalThis so the store survives Next.js dev-server module reloads.
const globalForStore = globalThis as unknown as { __afroEgyptStore?: Store };

export const db: Store = globalForStore.__afroEgyptStore ?? emptyStore();

if (!globalForStore.__afroEgyptStore) {
  globalForStore.__afroEgyptStore = db;
}

export function addAuditLog(entry: Omit<AuditLogEntry, "id" | "timestamp">) {
  db.auditLog.unshift({
    id: `AUD-${db.auditLog.length + 1}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

export function getEmployee(id: string) {
  return db.employees.find((e) => e.id === id);
}

export function getDepartment(id: string) {
  return db.departments.find((d) => d.id === id);
}

export function getShift(id: string) {
  return db.shifts.find((s) => s.id === id);
}
