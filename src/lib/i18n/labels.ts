import { Dictionary } from "@/lib/i18n/dictionary";
import {
  AllowanceType,
  AttendanceStatus,
  DeductionType,
  LeaveType,
  PayrollPeriodStatus,
  PayrollRecord,
  RequestStatus,
  Role,
  User,
} from "@/lib/types";

// Demo accounts whose "name" is really a generic role description (not a person's
// proper name) — translate these; real names (e.g. "Ahmed HR", "أحمد علي") stay as typed.
const GENERIC_DEMO_NAMES = new Set(["مدير النظام", "مشرف الإنتاج"]);

export function displayUserName(user: Pick<User, "name" | "role" | "departmentId">, t: Dictionary): string {
  if (!GENERIC_DEMO_NAMES.has(user.name)) return user.name;
  return roleLabel(user.role, t);
}

export function attendanceStatusLabel(status: AttendanceStatus, t: Dictionary): string {
  const map: Record<AttendanceStatus, string> = {
    present: t.statuses.present,
    late: t.statuses.late,
    absent: t.statuses.absent,
    leave: t.statuses.leave,
    mission: t.statuses.mission,
    excused_absence: t.statuses.excusedAbsence,
    early_leave: t.statuses.earlyLeave,
    missing_punch: t.statuses.missingPunch,
  };
  return map[status];
}

export function requestStatusLabel(status: RequestStatus, t: Dictionary): string {
  const map: Record<RequestStatus, string> = {
    pending: t.statuses.pending,
    approved: t.statuses.approved,
    rejected: t.statuses.rejected,
  };
  return map[status];
}

export function leaveTypeLabel(type: LeaveType, t: Dictionary): string {
  const map: Record<LeaveType, string> = {
    annual: t.leaveTypes.annual,
    casual: t.leaveTypes.casual,
    sick: t.leaveTypes.sick,
    unpaid: t.leaveTypes.unpaid,
    mission: t.leaveTypes.mission,
    permission: t.leaveTypes.permission,
    excused_absence: t.leaveTypes.excusedAbsence,
  };
  return map[type];
}

export function deductionTypeLabel(type: DeductionType, t: Dictionary): string {
  const map: Record<DeductionType, string> = {
    late: t.deductionTypes.late,
    absence: t.deductionTypes.absence,
    early_leave: t.deductionTypes.earlyLeave,
    penalty: t.deductionTypes.penalty,
    advance: t.deductionTypes.advance,
    admin_deduction: t.deductionTypes.adminDeduction,
    other: t.deductionTypes.other,
  };
  return map[type];
}

export function allowanceTypeLabel(type: AllowanceType, t: Dictionary): string {
  const map: Record<AllowanceType, string> = {
    transport: t.allowanceTypes.transport,
    meal: t.allowanceTypes.meal,
    fixed: t.allowanceTypes.fixed,
    incentive: t.allowanceTypes.incentive,
    bonus: t.allowanceTypes.bonus,
  };
  return map[type];
}

export function payrollPeriodStatusLabel(status: PayrollPeriodStatus, t: Dictionary): string {
  const map: Record<PayrollPeriodStatus, string> = {
    draft: t.payrollPeriodStatus.draft,
    calculated: t.payrollPeriodStatus.calculated,
    approved: t.payrollPeriodStatus.approved,
    closed: t.payrollPeriodStatus.closed,
  };
  return map[status];
}

export function roleLabel(role: Role, t: Dictionary): string {
  const map: Record<Role, string> = {
    admin: t.roles.admin,
    hr: t.roles.hr,
    supervisor: t.roles.supervisor,
    employee: t.roles.employee,
  };
  return map[role];
}

export const NAV_ITEMS = [
  { href: "/dashboard", key: "dashboard", icon: "LayoutDashboard" },
  { href: "/employees", key: "employees", icon: "Users" },
  { href: "/departments", key: "departments", icon: "Building2" },
  { href: "/shifts", key: "shifts", icon: "Clock" },
  { href: "/attendance", key: "attendance", icon: "Fingerprint" },
  { href: "/leaves", key: "leaves", icon: "CalendarDays" },
  { href: "/overtime", key: "overtime", icon: "TimerReset" },
  { href: "/deductions", key: "deductions", icon: "MinusCircle" },
  { href: "/payroll", key: "payroll", icon: "Wallet" },
  { href: "/reports", key: "reports", icon: "FileBarChart" },
  { href: "/workforce-cost", key: "workforceCost", icon: "TrendingUp" },
  { href: "/audit-log", key: "auditLog", icon: "History" },
  { href: "/settings", key: "settings", icon: "Settings" },
] as const;

export function navLabel(key: (typeof NAV_ITEMS)[number]["key"], t: Dictionary): string {
  return t.nav[key];
}

export interface BreakdownRow {
  label: string;
  amount: number;
}

/** Builds payslip/breakdown line items from a PayrollRecord's numeric fields — never from pre-baked labels, so it stays correct in either language. */
export function payrollBreakdownRows(record: PayrollRecord, t: Dictionary): { earnings: BreakdownRow[]; deductions: BreakdownRow[] } {
  return {
    earnings: [
      { label: t.payslip.basicSalary, amount: record.basicSalary },
      { label: t.payslip.allowances, amount: record.allowances },
      { label: t.payslip.overtime, amount: record.overtimeAmount },
      ...(record.incentives ? [{ label: t.allowanceTypes.incentive, amount: record.incentives }] : []),
      ...(record.bonuses ? [{ label: t.allowanceTypes.bonus, amount: record.bonuses }] : []),
    ],
    deductions: [
      { label: t.payslip.lateDeduction, amount: record.lateDeduction },
      { label: t.payslip.absenceDeduction, amount: record.absenceDeduction },
      ...(record.earlyLeaveDeduction ? [{ label: t.payslip.earlyLeaveDeduction, amount: record.earlyLeaveDeduction }] : []),
      ...(record.penalties ? [{ label: t.payslip.penalties, amount: record.penalties }] : []),
      ...(record.advances ? [{ label: t.payslip.advances, amount: record.advances }] : []),
      ...(record.otherDeductions ? [{ label: t.payslip.otherDeductions, amount: record.otherDeductions }] : []),
    ],
  };
}
