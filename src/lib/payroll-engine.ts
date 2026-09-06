import { Deduction, Employee, PayrollRecord, PayrollSettings } from "@/lib/types";

export interface PayrollInputs {
  employee: Employee;
  allowancesTotal: number;
  approvedOvertimeAmount: number;
  incentives: number;
  bonuses: number;
  lateMinutesTotal: number;
  /** Monthly employees only: absent days deducted from the full salary. Ignored for daily. */
  absenceDays: number;
  /** Daily employees only: worked days that get paid this period. Ignored for monthly. */
  paidDays: number;
  earlyLeaveMinutesTotal: number;
  deductions: Deduction[]; // penalties / advances / admin / other for the period (manual entries only)
  settings: PayrollSettings & { lateDeductionPerMinute: number; earlyLeaveDeductionPerMinute: number };
}

/**
 * Pure payroll calculation per spec §29–31. Never hardcode a final salary.
 *
 * Two modes, branched on `employee.salaryType`:
 *  - monthly: base = the full `basicSalary`; absent days are deducted from it.
 *  - daily:   base = `paidDays × dailyRate`; absent days are simply not in the
 *             count, so there is no separate absence deduction. A single punch
 *             (`missing_punch`) still counts as a paid day — that is handled by
 *             the caller when it computes `paidDays`.
 * Late / early-leave deductions apply to both modes.
 */
export function calculatePayrollRecord(
  periodId: string,
  inputs: PayrollInputs,
): Omit<PayrollRecord, "id"> {
  const { employee, settings } = inputs;
  const isDaily = employee.salaryType === "daily";

  const allowances = inputs.allowancesTotal;
  const overtimeAmount = Math.round(inputs.approvedOvertimeAmount);
  const incentives = inputs.incentives;
  const bonuses = inputs.bonuses;

  const monthlyDailyRate = employee.basicSalary / settings.workingDaysPerMonth;
  const dailyRateApplied = isDaily
    ? employee.dailyRate ?? Math.round(monthlyDailyRate)
    : undefined;

  // "basicSalary" on the record = the base pay for this period.
  const basicSalary = isDaily
    ? Math.round(inputs.paidDays * (dailyRateApplied ?? 0))
    : employee.basicSalary;

  const grossSalary = basicSalary + allowances + overtimeAmount + incentives + bonuses;

  const lateDeduction = Math.round(inputs.lateMinutesTotal * settings.lateDeductionPerMinute);

  const absenceDeduction = isDaily
    ? 0
    : Math.round(inputs.absenceDays * monthlyDailyRate);

  const earlyLeaveDeduction = Math.round(
    inputs.earlyLeaveMinutesTotal * settings.earlyLeaveDeductionPerMinute,
  );

  const penalties = sumByType(inputs.deductions, "penalty");
  const advances = sumByType(inputs.deductions, "advance");
  const otherDeductions =
    sumByType(inputs.deductions, "admin_deduction") + sumByType(inputs.deductions, "other");

  const totalDeductions =
    lateDeduction + absenceDeduction + earlyLeaveDeduction + penalties + advances + otherDeductions;

  const netSalary = grossSalary - totalDeductions;

  return {
    periodId,
    employeeId: employee.id,
    basicSalary,
    allowances,
    overtimeAmount,
    incentives,
    bonuses,
    grossSalary,
    lateDeduction,
    absenceDeduction,
    earlyLeaveDeduction,
    penalties,
    advances,
    otherDeductions,
    totalDeductions,
    netSalary,
    paidDaysCount: isDaily ? inputs.paidDays : undefined,
    dailyRateApplied,
  };
}

function sumByType(deductions: Deduction[], type: Deduction["type"]) {
  return deductions.filter((d) => d.type === type).reduce((sum, d) => sum + d.amount, 0);
}
