import { Dictionary } from "@/lib/i18n/dictionary";

/**
 * A change request carries the data it will write when approved. This turns that data into something a
 * person can read on the review screen: a plain label for each field, and a plain value for the ones that
 * are stored as codes. Internal references (record ids) are left out — they say nothing to the reviewer.
 */

const HIDDEN = new Set(["id", "employeeId", "departmentId", "shiftId", "periodId", "payTypeId", "workScheduleId", "targetId", "managerId", "userId"]);
/** Fields whose name ends in "Id" but which are real information for the reviewer, not a record reference. */
const VISIBLE_IDS = new Set(["nationalId", "biometricDeviceUserId"]);

export function isHiddenPayloadField(key: string): boolean {
  if (VISIBLE_IDS.has(key)) return false;
  return HIDDEN.has(key) || key.endsWith("Id");
}

export function payloadFieldLabel(key: string, t: Dictionary): string {
  const map: Record<string, string> = {
    // employee
    name: t.employees.formName,
    jobTitle: t.employees.formJobTitle,
    hireDate: t.employees.formHireDate,
    salaryType: t.employees.formSalaryType,
    basicSalary: t.employees.formBasicSalary,
    dailyRate: t.employees.formDailyRate,
    dailyWorkingHours: t.employees.formDailyHours,
    allowances: t.employees.formAllowances,
    status: t.common.status,
    phone: t.employees.formPhone,
    address: t.employees.formAddress,
    qualification: t.employees.formQualification,
    militaryStatus: t.employees.formMilitaryStatus,
    nationalId: t.employees.formNationalId,
    biometricDeviceUserId: t.employees.formBiometricId,
    scheduleMode: t.employees.scheduleMode,
    customWorkStart: t.employees.customStart,
    customWorkEnd: t.employees.customEnd,
    customOvertimeStart: t.employees.customOvertimeStart,
    // deductions / overtime / leaves
    type: t.deductions.formType,
    amount: t.deductions.formAmount,
    date: t.common.date,
    reason: t.common.reason,
    notes: t.common.notes,
    hours: t.overtime.formHours,
    hourlyRate: t.overtime.formRate,
    decision: t.common.status,
    from: t.common.from,
    to: t.common.to,
    // shifts and schedules
    startTime: t.shifts.formStart,
    endTime: t.shifts.formEnd,
    gracePeriodMinutes: t.shifts.formGrace,
    allowOvertime: t.shifts.formAllowOvertime,
    // settings
    companyName: t.settings.companyName,
    overtimeHourlyMultiplier: t.settings.overtimeMultiplier,
    workingDaysPerMonth: t.settings.workingDaysPerMonth,
    workingHoursPerDay: t.settings.workingHoursPerDay,
    defaultGracePeriodMinutes: t.settings.defaultGrace,
    lateDeductionPerMinute: t.settings.lateDeductionPerMinute,
    earlyLeaveDeductionPerMinute: t.settings.earlyLeaveDeductionPerMinute,
    absenceDeductionDays: t.settings.absenceDeductionDays,
    // payroll periods
    year: t.payroll.year,
    month: t.payroll.month,
  };
  return map[key] ?? key;
}

/** Codes stored in a payload (statuses, pay types…) as the words the rest of the system uses. */
export function payloadValueText(key: string, value: unknown, t: Dictionary): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? t.common.confirm : t.common.cancel;
  if (Array.isArray(value)) return value.map((v) => payloadValueText(key, v, t)).join("، ");
  if (typeof value === "object") return JSON.stringify(value);

  const text = String(value);
  const words: Record<string, Record<string, string>> = {
    salaryType: { monthly: t.employees.salaryMonthly, daily: t.employees.salaryDaily },
    status: {
      active: t.employees.statusActive,
      on_leave: t.employees.statusOnLeave,
      terminated: t.employees.statusTerminated,
      approved: t.statuses.approved,
      rejected: t.statuses.rejected,
      pending: t.statuses.pending,
    },
    decision: { approved: t.statuses.approved, rejected: t.statuses.rejected },
    militaryStatus: {
      completed: t.employees.militaryCompleted,
      exempted: t.employees.militaryExempted,
      postponed: t.employees.militaryPostponed,
      not_applicable: t.employees.militaryNotApplicable,
    },
    scheduleMode: { schedule: t.employees.modeSchedule, custom: t.employees.modeCustom, shift: t.employees.modeShift },
    type: {
      late: t.deductionTypes.late,
      absence: t.deductionTypes.absence,
      early_leave: t.deductionTypes.earlyLeave,
      permission: t.deductionTypes.permission,
      unauthorized_exit: t.deductionTypes.unauthorizedExit,
      penalty: t.deductionTypes.penalty,
      advance: t.deductionTypes.advance,
      admin_deduction: t.deductionTypes.adminDeduction,
      other: t.deductionTypes.other,
    },
  };
  return words[key]?.[text] ?? text;
}

/** The readable fields of a change request's payload, in the order they were stored. */
export function payloadRows(payload: unknown, t: Dictionary): { label: string; value: string }[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([key]) => !isHiddenPayloadField(key))
    .map(([key, value]) => ({ label: payloadFieldLabel(key, t), value: payloadValueText(key, value, t) }));
}
