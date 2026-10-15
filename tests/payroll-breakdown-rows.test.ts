import { describe, expect, it } from "vitest";
import { payrollBreakdownRows } from "@/lib/i18n/labels";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { getDictionary } from "@/lib/i18n";
import type { Deduction, Employee, PayrollRecord } from "@/lib/types";

/**
 * The payslip and the /payroll breakdown show: the earnings, their total (without overtime), overtime on its own
 * line, the deductions, then the net. Display only — the records are the engine's own, untouched, and the net
 * shown is the stored one: total + overtime − deductions must still come to it.
 */
const t = getDictionary("ar");

const employee = (salaryType: "monthly" | "daily"): Employee =>
  ({ id: "e", employeeNumber: "E", name: "x", departmentId: "D", jobTitle: "x", hireDate: "2024-01-01", shiftId: "s", salaryType, basicSalary: 6000, dailyWorkingHours: 10, allowances: 0, status: "active" }) as Employee;
const deduction = (type: Deduction["type"], amount: number): Deduction =>
  ({ id: type, employeeId: "e", type, amount, date: "2026-10-01", reason: "", createdAt: "2026-10-01" }) as Deduction;

const record = (salaryType: "monthly" | "daily", overtime: number) =>
  ({
    id: "R",
    ...calculatePayrollRecord("P", {
      employee: employee(salaryType),
      allowancesTotal: 500,
      approvedOvertimeAmount: overtime,
      incentives: 100,
      bonuses: 250,
      dayRate: 230,
      paidDays: 24,
      deductions: [deduction("late", 40), deduction("penalty", 100), deduction("advance", 300)],
    }),
  }) as PayrollRecord;

describe("payslip lines: total without overtime, then overtime on its own", () => {
  it("salaried: total = basic + allowances + incentive + bonus; overtime is its own line; the net is unchanged", () => {
    const r = record("monthly", 700);
    const rows = payrollBreakdownRows(r, t);
    expect(rows.total).toBe(6000 + 500 + 100 + 250);
    expect(rows.total).toBe(rows.earnings.reduce((s, e) => s + e.amount, 0));
    expect(rows.earnings.map((e) => e.label)).not.toContain(t.payslip.overtime);
    expect(rows.overtime).toEqual({ label: t.payslip.overtime, amount: 700 });
    expect(rows.total + rows.overtime.amount - r.totalDeductions).toBe(r.netSalary);
    // the stored values are what they were: gross still includes the overtime
    expect(r.grossSalary).toBe(rows.total + 700);
  });

  it("daily worker: total = paid days × day rate + allowances + incentive + bonus; the net is unchanged", () => {
    const r = record("daily", 460);
    const rows = payrollBreakdownRows(r, t);
    expect(rows.earnings[0]).toEqual({ label: `${t.payslip.basicSalary} (24 ${t.common.days} × 230)`, amount: 24 * 230 });
    expect(rows.total).toBe(24 * 230 + 500 + 100 + 250);
    expect(rows.overtime.amount).toBe(460);
    expect(rows.total + rows.overtime.amount - r.totalDeductions).toBe(r.netSalary);
  });

  it("no overtime: the line is still shown, at 0, and the total is the whole gross", () => {
    const r = record("monthly", 0);
    const rows = payrollBreakdownRows(r, t);
    expect(rows.overtime).toEqual({ label: t.payslip.overtime, amount: 0 });
    expect(rows.total).toBe(r.grossSalary);
    expect(rows.total - r.totalDeductions).toBe(r.netSalary);
  });
});
