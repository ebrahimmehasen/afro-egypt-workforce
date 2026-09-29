export type Role = "admin" | "hr" | "supervisor" | "staff" | "employee";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  employeeId?: string; // linked employee record, for the employee self-service role
  departmentId?: string; // legacy single-department link — superseded by departmentIds
  departmentIds?: string[]; // scope for hr/supervisor "اداري" accounts; empty = all departments
  permissions?: string[]; // granular page grants for hr/supervisor "اداري" accounts; ignored for admin/employee
}

export type EmployeeStatus = "active" | "on_leave" | "terminated";

export type SalaryType = "monthly" | "daily";

export type MilitaryStatus = "completed" | "exempted" | "postponed" | "not_applicable";

export type Gender = "male" | "female";

export interface Employee {
  id: string; // EMP-1001
  employeeNumber: string; // "<DEPT_CODE>-<seq>", e.g. ACC-001 — display-facing, distinct from id and biometricDeviceUserId
  name: string;
  departmentId: string;
  jobTitle: string;
  hireDate: string; // ISO date
  shiftId: string;
  salaryType: SalaryType; // mirrors the pay type's basis
  payTypeId?: string; // the pay type whose rules apply; unset = the built-in type for salaryType
  workScheduleId?: string; // a fixed schedule; custom times below win when set
  customWorkStart?: string;
  customWorkEnd?: string;
  customOvertimeStart?: string;
  basicSalary: number; // monthly: full salary; daily: fallback only
  dailyRate?: number; // set when salaryType === "daily"
  dailyWorkingHours: number; // contracted daily hours
  overtimeEligible?: boolean; // "له إضافي" — the system posts automatic overtime when true or unset
  allowances: number; // fixed monthly allowances total (for quick display; itemized in Allowance[])
  biometricDeviceUserId?: string; // linked from /biometric-device, not the employee form
  status: EmployeeStatus;
  phone?: string;
  address?: string;
  qualification?: string;
  militaryStatus?: MilitaryStatus;
  nationalId?: string;
  /** Drives the default required-document list (the military certificate is male-only); unset for rows
   * saved before this existed. */
  gender?: Gender;
  /** "سواق" — drives whether a driving licence and a vehicle-receipt acknowledgment are asked for. */
  isDriver?: boolean;
  /** This employee's own required-document list; unset means the company default (see
   * defaultRequiredDocumentTypes in @/lib/documents). */
  requiredDocuments?: EmployeeDocumentType[];
  /** Same idea, for the signed-acknowledgment checklist (see defaultRequiredAcknowledgmentKeys in
   * @/lib/acknowledgments). */
  requiredAcknowledgments?: StandardAcknowledgmentKey[];
  avatarColor?: string;
}

export interface Department {
  id: string;
  name: string;
  /** The head's employee id; unset until one is chosen. */
  managerId?: string;
  /** The head's current name, read from the linked employee — never stored on the department. */
  managerName?: string;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string; // "08:00"
  endTime: string; // "16:00" (may cross midnight)
  gracePeriodMinutes: number;
  workDays: number[]; // 0=Sunday..6=Saturday
  allowOvertime: boolean;
}

export type PunchType = "in" | "out";
export type PunchSource = "biometric" | "manual_correction" | "simulated";

/** Immutable raw biometric record. Never edited or deleted. */
export interface AttendanceLog {
  id: string;
  employeeId: string;
  deviceId: string;
  timestamp: string; // ISO datetime
  punchType: PunchType;
  source: PunchSource;
}

export type AttendanceStatus =
  | "present"
  | "late"
  | "absent"
  | "leave"
  | "mission"
  | "excused_absence"
  | "early_leave"
  | "missing_punch";

export interface DailyAttendance {
  id: string;
  employeeId: string;
  date: string; // ISO date (yyyy-MM-dd)
  shiftId: string;
  scheduledStart: string; // ISO datetime
  scheduledEnd: string; // ISO datetime
  actualIn: string | null; // ISO datetime
  actualOut: string | null; // ISO datetime
  lateMinutes: number;
  deductibleLateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
  correctionReason?: string;
  correctedBy?: string;
  correctedAt?: string;
}

export type LeaveType =
  | "annual"
  | "casual"
  | "sick"
  | "unpaid"
  | "mission"
  | "permission"
  | "excused_absence";

export type RequestStatus = "pending" | "approved" | "rejected";

export interface Leave {
  id: string;
  employeeId: string;
  type: LeaveType;
  from: string; // ISO date
  to: string; // ISO date
  reason: string;
  status: RequestStatus;
  approvedBy?: string;
  createdAt: string;
}

export interface Overtime {
  id: string;
  employeeId: string;
  date: string;
  hours: number;
  hourlyRate: number;
  amount: number;
  status: RequestStatus;
  approvedBy?: string;
  notes?: string;
  createdAt: string;
  kind?: string; // overtime | friday | holiday | thursday_extra
  multiplier?: number;
  autoGenerated?: boolean; // posted by the system from attendance
  originalHours?: number; // what the system calculated, kept after an edit
  originalAmount?: number;
  editedBy?: string;
}

export type DeductionType =
  | "late"
  | "absence"
  | "early_leave"
  | "permission"
  | "unauthorized_exit"
  | "penalty"
  | "advance"
  | "admin_deduction"
  | "other";

export interface Deduction {
  id: string;
  employeeId: string;
  type: DeductionType;
  amount: number;
  date: string;
  reason: string;
  notes?: string;
  createdAt: string;
  autoGenerated?: boolean; // posted by the system from attendance, not entered by a person
  editedBy?: string; // someone changed a system deduction by hand
  originalAmount?: number; // what the system calculated, kept after an edit
}

export type AllowanceType = "transport" | "meal" | "fixed" | "incentive" | "bonus";

export interface Allowance {
  id: string;
  employeeId: string;
  type: AllowanceType;
  amount: number;
  monthly: boolean;
  effectiveYear?: number; // set when monthly === false (a one-off bonus)
  effectiveMonth?: number; // 1-12
  notes?: string;
}

export type PayrollPeriodStatus = "draft" | "calculated" | "approved" | "closed";

export interface PayrollPeriod {
  id: string;
  label: string; // "أغسطس 2026"
  year: number;
  month: number; // 1-12
  status: PayrollPeriodStatus;
  calculatedAt?: string;
  approvedAt?: string;
  closedAt?: string;
}

export interface PayrollRecord {
  id: string;
  periodId: string;
  employeeId: string;
  basicSalary: number;
  allowances: number;
  overtimeAmount: number;
  incentives: number;
  bonuses: number;
  grossSalary: number;
  lateDeduction: number;
  absenceDeduction: number;
  earlyLeaveDeduction: number;
  penalties: number;
  advances: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
  paidDaysCount?: number; // daily employees only
  dailyRateApplied?: number; // daily employees only
}

export type EmployeeDocumentType =
  | "national_id_photo"
  | "birth_certificate"
  | "criminal_record"
  | "health_certificate"
  | "work_contract"
  | "social_insurance_form"
  | "job_application_form"
  | "qualification_certificate"
  | "personal_photo"
  | "military_certificate"
  | "work_experience_certificate"
  | "cv"
  | "driving_license"
  | "company_policy"
  | "experience_certificate"
  | "other";

/**
 * "المستوى الأول" — the core service-file checklist, asked of every employee regardless of
 * gender or job. These are the ones reported as *missing* for everyone.
 */
export const CORE_REQUIRED_EMPLOYEE_DOCUMENT_TYPES: EmployeeDocumentType[] = [
  "cv",
  "birth_certificate",
  "qualification_certificate",
  "criminal_record",
  "work_experience_certificate",
  "personal_photo",
  "national_id_photo",
  "job_application_form",
  "social_insurance_form",
];

/** Kept for any code still importing the old name — the company-wide default with no employee context. */
export const REQUIRED_EMPLOYEE_DOCUMENT_TYPES = CORE_REQUIRED_EMPLOYEE_DOCUMENT_TYPES;

/**
 * "المستوى الثالث" — additional paperwork, never demanded by default. `work_contract` and
 * `company_policy` are kept only so any file already on record stays visible and manageable; the
 * company now asks for both as signed acknowledgments instead (see @/lib/acknowledgments).
 */
export const OPTIONAL_EMPLOYEE_DOCUMENT_TYPES: EmployeeDocumentType[] = [
  "health_certificate",
  "experience_certificate",
  "work_contract",
  "company_policy",
  "other",
];

/** Conditionally required (still "المستوى الأول"): military service only applies to men, a
 * driving licence only to a driver. See defaultRequiredDocumentTypes in @/lib/documents. */
export const CONDITIONAL_EMPLOYEE_DOCUMENT_TYPES = {
  military_certificate: "male",
  driving_license: "driver",
} as const;

export const EMPLOYEE_DOCUMENT_TYPES: EmployeeDocumentType[] = [
  ...CORE_REQUIRED_EMPLOYEE_DOCUMENT_TYPES,
  ...(Object.keys(CONDITIONAL_EMPLOYEE_DOCUMENT_TYPES) as EmployeeDocumentType[]),
  ...OPTIONAL_EMPLOYEE_DOCUMENT_TYPES,
];

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  type: EmployeeDocumentType;
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
  uploadedBy?: string;
  uploadedAt: string;
}

/** The three fixed acknowledgment slots. Custom slots use `key` = "custom-<id>". */
export const STANDARD_ACKNOWLEDGMENT_KEYS = [
  // "المستوى الثاني" — required signatures (see defaultRequiredAcknowledgmentKeys in @/lib/acknowledgments).
  "address_confirmation", // إقرار صحة عنوان
  "employment_terms", // عقد عمل
  "work_receipt", // إقرار استلام عمل
  "internal_bylaws", // اللائحة الداخلية للمصنع
  "vehicle_receipt", // إقرار استلام عربية — سواق فقط
  // "المستوى الثالث" and legacy — never required by default.
  "custody_receipt", // إقرار استلام عهدة
  "confidentiality",
] as const;
export type StandardAcknowledgmentKey = (typeof STANDARD_ACKNOWLEDGMENT_KEYS)[number];

export interface EmployeeAcknowledgment {
  id: string;
  employeeId: string;
  key: string;
  label: string;
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
  uploadedBy?: string;
  uploadedAt: string;
}

export interface AuditLogEntry {
  id: string;
  userName: string;
  action: string; // e.g. "تعديل حضور"
  module: string; // e.g. "الحضور والانصراف"
  oldValue: string;
  newValue: string;
  reason?: string;
  timestamp: string;
}

export interface CompanySettings {
  companyName: string;
  logoUrl: string;
  address: string;
  phone: string;
}

export interface AttendanceSettings {
  defaultGracePeriodMinutes: number;
  lateDeductionPerMinute: number; // EGP per minute, demo rule
  earlyLeaveDeductionPerMinute: number;
  absenceDeductionDays: number; // how many days' salary deducted per absence
  weeklyOffDays: string; // comma-separated day numbers, 0 = Sunday … 5 = Friday
}

export interface PayrollSettings {
  overtimeHourlyMultiplier: number; // multiplier applied on basic hourly rate
  workingDaysPerMonth: number;
  workingHoursPerDay: number;
  payPeriodStartDay: number; // the pay month runs from this day of the month before
}
