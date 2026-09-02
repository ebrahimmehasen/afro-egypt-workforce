import { Deduction, Employee, PayrollRecord, PayrollSettings } from "@/lib/types";

export interface PayrollInputs {
  employee: Employee;
  allowancesTotal: number;
  approvedOvertimeAmount: number;
  incentives: number;
  bonuses: number;
  lateMinutesTotal: number;
  absenceDays: number;
  earlyLeaveMinutesTotal: number;
  deductions: Deduction[]; // penalties / advances / admin / other for the period (manual entries only)
  settings: PayrollSettings & { lateDeductionPerMinute: number; earlyLeaveDeductionPerMinute: number };
}

/** Pure payroll calculation per spec §29–31. Never hardcode a final salary. */
export function calculatePayrollRecord(
  periodId: string,
  inputs: PayrollInputs,
): Omit<PayrollRecord, "id"> {
  const { employee, settings } = inputs;

  const basicSalary = employee.basicSalary;
  const allowances = inputs.allowancesTotal;
  const overtimeAmount = Math.round(inputs.approvedOvertimeAmount);
  const incentives = inputs.incentives;
  const bonuses = inputs.bonuses;

  const grossSalary = basicSalary + allowances + overtimeAmount + incentives + bonuses;

  const lateDeduction = Math.round(inputs.lateMinutesTotal * settings.lateDeductionPerMinute);

  const dailyRate = basicSalary / settings.workingDaysPerMonth;
  const absenceDeduction = Math.round(inputs.absenceDays * dailyRate);

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
  };
}

function sumByType(deductions: Deduction[], type: Deduction["type"]) {
  return deductions.filter((d) => d.type === type).reduce((sum, d) => sum + d.amount, 0);
}
