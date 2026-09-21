import { describe, expect, it } from "vitest";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { Deduction, Employee } from "@/lib/types";

const AHMED: Employee = {
  id: "EMP-1001",
  employeeNumber: "PROD-001",
  name: "أحمد علي",
  departmentId: "DEP-1",
  jobTitle: "عامل خط تعبئة",
  hireDate: "2025-07-01",
  shiftId: "SHIFT-MORNING",
  salaryType: "monthly",
  basicSalary: 12000,
  dailyWorkingHours: 10,
  allowances: 1000,
  biometricDeviceUserId: "1001",
  status: "active",
};

const DAILY_WORKER: Employee = { ...AHMED, id: "EMP-2001", name: "عامل يومية", salaryType: "daily", basicSalary: 5200 };

function ded(type: Deduction["type"], amount: number): Deduction {
  return { id: `DED-${type}-${amount}`, employeeId: AHMED.id, type, amount, date: "2026-08-10", reason: "test", createdAt: "2026-08-10T10:00:00" };
}

// the day rate comes from the pay type (salary ÷ its divisor) — the caller works it out
const NOTHING = { allowancesTotal: 0, approvedOvertimeAmount: 0, incentives: 0, bonuses: 0, paidDays: 0, dayRate: 0, deductions: [] };

describe("calculatePayrollRecord — salaried", () => {
  it("pays the full salary and takes off every deduction of the month, each in its own bucket", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      ...NOTHING,
      employee: AHMED,
      allowancesTotal: 1000,
      approvedOvertimeAmount: 800,
      deductions: [ded("late", 200), ded("absence", 800), ded("early_leave", 40), ded("permission", 30), ded("unauthorized_exit", 20), ded("penalty", 300), ded("advance", 1000), ded("other", 50)],
    });

    expect(record.basicSalary).toBe(12000);
    expect(record.grossSalary).toBe(13800);
    expect(record.lateDeduction).toBe(200);
    expect(record.absenceDeduction).toBe(800);
    expect(record.earlyLeaveDeduction).toBe(40 + 30 + 20); // early leave, permission and leaving without one
    expect(record.penalties).toBe(300);
    expect(record.advances).toBe(1000);
    expect(record.otherDeductions).toBe(50);
    expect(record.totalDeductions).toBe(2440);
    expect(record.netSalary).toBe(13800 - 2440);
    expect(record.paidDaysCount).toBeUndefined();
    expect(record.dailyRateApplied).toBeUndefined();
  });

  it("rounds overtime to whole EGP", () => {
    expect(calculatePayrollRecord("P", { ...NOTHING, employee: AHMED, approvedOvertimeAmount: 799.6 }).overtimeAmount).toBe(800);
  });
});

describe("calculatePayrollRecord — daily worker", () => {
  it("pays the paid days at the day rate from the pay type (5200 ÷ 26 = 200)", () => {
    const record = calculatePayrollRecord("P", { ...NOTHING, employee: DAILY_WORKER, dayRate: 200, paidDays: 22, allowancesTotal: 200 });
    expect(record.dailyRateApplied).toBe(200); // 5200 / 26
    expect(record.basicSalary).toBe(4400);
    expect(record.grossSalary).toBe(4600);
    expect(record.paidDaysCount).toBe(22);
  });

  it("uses the day rate it is given (a worker's own rate when one is set)", () => {
    const record = calculatePayrollRecord("P", { ...NOTHING, employee: { ...DAILY_WORKER, dailyRate: 250 }, dayRate: 250, paidDays: 10 });
    expect(record.dailyRateApplied).toBe(250);
    expect(record.basicSalary).toBe(2500);
  });

  it("takes the posted deductions off the same way", () => {
    const record = calculatePayrollRecord("P", {
      ...NOTHING,
      employee: DAILY_WORKER,
      dayRate: 200,
      paidDays: 20,
      deductions: [ded("absence", 400), ded("late", 50), ded("advance", 500)],
    });
    expect(record.grossSalary).toBe(4000);
    expect(record.totalDeductions).toBe(950);
    expect(record.netSalary).toBe(3050);
  });
});
