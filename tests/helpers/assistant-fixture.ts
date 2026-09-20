import type { Store } from "@/lib/store";
import type { Employee } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import type { ToolContext } from "@/lib/assistant/employee-tools";

// Fictional people and ids only. The secret ids stand in for the internal database ids, which must never
// reach the model.
const emp = (over: Partial<Employee> & Pick<Employee, "id" | "employeeNumber" | "name">): Employee => ({
  departmentId: "d-prod",
  jobTitle: "نجار",
  hireDate: "2024-01-10",
  shiftId: "s1",
  salaryType: "monthly",
  basicSalary: 5000,
  dailyWorkingHours: 8,
  allowances: 0,
  status: "active",
  phone: "01000000000",
  address: "عنوان تجريبي",
  qualification: "دبلوم",
  nationalId: "00000000000000",
  biometricDeviceUserId: "7",
  ...over,
});

export const store = {
  employees: [
    emp({ id: "secret-id-1", employeeNumber: "PROD-001", name: "سامي تجريبي" }),
    emp({ id: "secret-id-2", employeeNumber: "PROD-002", name: "سامي آخر", basicSalary: 0, phone: undefined, nationalId: undefined, biometricDeviceUserId: undefined }),
    emp({ id: "secret-id-3", employeeNumber: "TBD-001", name: "منى تجريبية", departmentId: "d-tbd", hireDate: "2026-09-01", basicSalary: 0 }),
    emp({ id: "secret-id-4", employeeNumber: "PROD-003", name: "موظف سابق", status: "terminated", nationalId: undefined }),
  ],
  departments: [
    { id: "d-prod", name: "الإنتاج" },
    { id: "d-tbd", name: "غير محدد" },
  ],
  shifts: [{ id: "s1", name: "الصباحية", startTime: "08:00", endTime: "16:00", gracePeriodMinutes: 10, workDays: [0, 1, 2, 3, 4], allowOvertime: true }],
  dailyAttendance: [
    { id: "a1", employeeId: "secret-id-1", date: "2026-09-18", status: "present", lateMinutes: 0, actualIn: "2026-09-18T08:00:00Z" },
    { id: "a2", employeeId: "secret-id-1", date: "2026-09-19", status: "late", lateMinutes: 25, actualIn: "2026-09-19T08:25:00Z" },
    { id: "a3", employeeId: "secret-id-2", date: "2026-09-19", status: "absent", lateMinutes: 0, actualIn: null },
  ],
  leaves: [{ id: "l1", employeeId: "secret-id-1", type: "annual", from: "2026-08-01", to: "2026-08-05", status: "approved" }],
  overtime: [{ id: "o1", employeeId: "secret-id-1", date: "2026-09-10", hours: 3, amount: 150, status: "approved" }],
  deductions: [{ id: "x1", employeeId: "secret-id-1", type: "penalty", amount: 100, date: "2026-09-02" }],
  allowances: [],
  payrollPeriods: [{ id: "p1", label: "أغسطس 2026", year: 2026, month: 8 }],
  payrollRecords: [{ id: "r1", periodId: "p1", employeeId: "secret-id-1", grossSalary: 5200, totalDeductions: 100, netSalary: 5100 }],
  employeeDocuments: [
    { id: "doc1", employeeId: "secret-id-1", type: "national_id_photo" },
    { id: "doc2", employeeId: "secret-id-1", type: "national_id_photo" },
    { id: "doc3", employeeId: "secret-id-1", type: "birth_certificate" },
  ],
  employeeAcknowledgments: [],
} as unknown as Store;

export const ctx: ToolContext = { db: store, t: ar, locale: "ar", today: "2026-09-20" };

