import type { Department, DeductionType, Employee, PayrollRecord } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { deductionTypeLabel } from "@/lib/i18n/labels";
import { translateLabel } from "@/lib/i18n/data-labels";
import { terminatedLast } from "@/lib/employee-order";

/** Every deduction type, each in its own column, in the order the deductions page lists them. */
export const EXPORT_DEDUCTION_TYPES: DeductionType[] = [
  "late",
  "absence",
  "early_leave",
  "permission",
  "unauthorized_exit",
  "penalty",
  "advance",
  "admin_deduction",
  "other",
];

export type ExportCell = string | number | null;

/**
 * The "تفاصيل المرتبات" sheet: one header row, then one row per employee of the period, with their pay as it was
 * calculated. Pure — reads only what it is given and computes nothing new: every amount is a stored PayrollRecord
 * field, except the total (the stored gross less the stored overtime, as the payslip shows it) and the split of
 * the two record fields that hold several deduction types together (early leave /
 * permission / leaving without permission, and admin / other deductions), which is read from that period's posted
 * deductions — the same rows the payroll calculation summed — and never moves money out of the stored field, so the
 * deduction columns always add up to the stored total. Nothing about the company goes in: no name, logo,
 * title or footer, just the table from the first cell.
 *
 * Amounts are numbers (not text) in EGP. Terminated employees come last; nobody in the period is left out.
 */
export function payrollExportSheet(input: {
  records: PayrollRecord[];
  employees: Employee[];
  departments: Department[];
  /** the period's posted deductions (not removed), for the per-type split */
  deductions: { employeeId: string; type: string; amount: number }[];
  /** the employee's pay type name, e.g. "موظف شهري" / "يومية" */
  payTypeOf: (employee: Employee) => string;
  t: Dictionary;
  locale: "ar" | "en";
}): { headers: string[]; rows: ExportCell[][] } {
  const { t, locale } = input;
  const headers = [
    t.payslip.employeeId,
    t.payslip.employeeName,
    t.payslip.department,
    t.payroll.export.payType,
    t.payroll.export.paidDays,
    t.payroll.export.dayRate,
    t.payslip.basicSalary,
    t.payslip.allowances,
    t.allowanceTypes.incentive,
    t.allowanceTypes.bonus,
    // as on the payslip: the total without overtime, then overtime on its own, then the deductions, then the net
    t.payslip.total,
    t.payslip.overtime,
    ...EXPORT_DEDUCTION_TYPES.map((type) => deductionTypeLabel(type, t)),
    t.payroll.export.totalDeductions,
    t.payslip.netSalary,
  ];

  const employeeById = new Map(input.employees.map((e) => [e.id, e]));
  const deptName = new Map(input.departments.map((d) => [d.id, d.name]));
  const byType = (employeeId: string, type: DeductionType) =>
    input.deductions.filter((d) => d.employeeId === employeeId && d.type === type).reduce((s, d) => s + d.amount, 0);

  const rows = input.records
    .map((record) => ({ record, employee: employeeById.get(record.employeeId) }))
    .sort(
      (a, b) =>
        terminatedLast(a.employee, b.employee) ||
        (a.employee?.name ?? "").localeCompare(b.employee?.name ?? "", locale === "ar" ? "ar" : "en"),
    )
    .map(({ record, employee }) => {
      const id = record.employeeId;
      const isDaily = record.paidDaysCount != null;
      // The combined fields are split without leaving the stored amount: the specific types take what the posted
      // rows say (never more than the field holds), the field's own type keeps the rest. So the columns always add
      // up to the stored total — also for a period whose rows were since removed or never posted.
      const permission = Math.min(byType(id, "permission"), record.earlyLeaveDeduction);
      const unauthorizedExit = Math.min(byType(id, "unauthorized_exit"), record.earlyLeaveDeduction - permission);
      const adminDeduction = Math.min(byType(id, "admin_deduction"), record.otherDeductions);
      const deductionCells: Record<DeductionType, number> = {
        late: record.lateDeduction,
        absence: record.absenceDeduction,
        early_leave: round2(record.earlyLeaveDeduction - permission - unauthorizedExit),
        permission,
        unauthorized_exit: unauthorizedExit,
        penalty: record.penalties,
        advance: record.advances,
        admin_deduction: adminDeduction,
        other: round2(record.otherDeductions - adminDeduction),
      };
      return [
        employee?.employeeNumber ?? "",
        employee?.name ?? "",
        translateLabel(deptName.get(employee?.departmentId ?? "") ?? "", locale),
        employee ? input.payTypeOf(employee) : "",
        isDaily ? record.paidDaysCount! : null,
        isDaily ? record.dailyRateApplied ?? null : null,
        record.basicSalary,
        record.allowances,
        record.incentives,
        record.bonuses,
        record.grossSalary - record.overtimeAmount,
        record.overtimeAmount,
        ...EXPORT_DEDUCTION_TYPES.map((type) => deductionCells[type]),
        record.totalDeductions,
        record.netSalary,
      ];
    });
  return { headers, rows };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `payroll-details-2026-10.xlsx` — no company name in it. */
export function payrollExportFileName(year: number, month: number): string {
  return `payroll-details-${year}-${String(month).padStart(2, "0")}.xlsx`;
}
