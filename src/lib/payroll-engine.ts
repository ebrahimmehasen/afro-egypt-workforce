import { Deduction, Employee, PayrollRecord } from "@/lib/types";

export interface PayrollInputs {
  employee: Employee;
  allowancesTotal: number;
  approvedOvertimeAmount: number;
  incentives: number;
  bonuses: number;
  /** A day's pay, from the employee's pay type (salary / its day divisor, or a daily worker's own rate). */
  dayRate: number;
  /** Daily workers only: the days paid at the day rate this pay month. Ignored for salaried employees. */
  paidDays: number;
  /** Every deduction for the pay month: the ones the system posted from attendance (late, absence, leaving
   * leave) and the ones entered by hand (penalties, advances…). */
  deductions: Deduction[];
}

/**
 * Pure payroll calculation. Never hardcode a final salary.
 *
 * The base, by the pay type's basis:
 *  - salaried ("monthly"): the full `basicSalary`;
 *  - daily worker: `paidDays × day rate` (from the pay type: the salary over its divisor, or their own rate).
 * Everything taken off — absence, lateness, early leave, penalties, advances — comes from the deductions
 * posted for the month, so what the deductions page shows is exactly what the payslip takes.
 */
export function calculatePayrollRecord(periodId: string, inputs: PayrollInputs): Omit<PayrollRecord, "id"> {
  const { employee } = inputs;
  const isDaily = employee.salaryType === "daily";

  const allowances = inputs.allowancesTotal;
  const overtimeAmount = Math.round(inputs.approvedOvertimeAmount);
  const incentives = inputs.incentives;
  const bonuses = inputs.bonuses;

  const dailyRateApplied = isDaily ? Math.round(inputs.dayRate) : undefined;
  // "basicSalary" on the record = the base pay for this pay month.
  const basicSalary = isDaily ? Math.round(inputs.paidDays * inputs.dayRate) : employee.basicSalary;

  const grossSalary = basicSalary + allowances + overtimeAmount + incentives + bonuses;

  const lateDeduction = sumByType(inputs.deductions, "late");
  const absenceDeduction = sumByType(inputs.deductions, "absence");
  // time missed at the end of the day, however it was charged: with a permission or without one
  const earlyLeaveDeduction =
    sumByType(inputs.deductions, "early_leave") + sumByType(inputs.deductions, "permission") + sumByType(inputs.deductions, "unauthorized_exit");
  const penalties = sumByType(inputs.deductions, "penalty");
  const advances = sumByType(inputs.deductions, "advance");
  const otherDeductions = sumByType(inputs.deductions, "admin_deduction") + sumByType(inputs.deductions, "other");

  const totalDeductions = lateDeduction + absenceDeduction + earlyLeaveDeduction + penalties + advances + otherDeductions;
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
