import { describe, expect, it } from "vitest";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { Deduction, Employee } from "@/lib/types";

const AHMED: Employee = {
  id: "EMP-1001",
  name: "أحمد علي",
  departmentId: "DEP-1",
  jobTitle: "عامل خط تعبئة",
  hireDate: "2025-07-01",
  shiftId: "SHIFT-MORNING",
  salaryType: "monthly",
  basicSalary: 12000,
  dailyWorkingHours: 8,
  allowances: 1000,
  biometricDeviceUserId: "1001",
  status: "active",
};

const DAILY_WORKER: Employee = {
  ...AHMED,
  id: "EMP-2001",
  name: "عامل يومية",
  salaryType: "daily",
  basicSalary: 0,
  dailyRate: 400,
};

function ded(type: Deduction["type"], amount: number): Deduction {
  return {
    id: `DED-${type}`,
    employeeId: AHMED.id,
    type,
    amount,
    date: "2026-08-10",
    reason: "test",
    createdAt: "2026-08-10T10:00:00",
  };
}

const BASE_SETTINGS = {
  overtimeHourlyMultiplier: 1.5,
  workingDaysPerMonth: 30,
  workingHoursPerDay: 8,
  lateDeductionPerMinute: 5,
  earlyLeaveDeductionPerMinute: 5,
};

const NO_DAYS = { absenceDays: 0, paidDays: 0 };

describe("calculatePayrollRecord — monthly", () => {
  it("reproduces the spec §30 demo example (net = 11,900 EGP)", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: AHMED,
      allowancesTotal: 1000,
      approvedOvertimeAmount: 800,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal: 40, // 40 * 5 = 200
      absenceDays: 1, // 1 * (12000 / 30) = 400
      paidDays: 0,
      earlyLeaveMinutesTotal: 0,
      deductions: [ded("penalty", 300), ded("advance", 1000)],
      settings: BASE_SETTINGS,
    });

    expect(record.grossSalary).toBe(13800);
    expect(record.lateDeduction).toBe(200);
    expect(record.absenceDeduction).toBe(400);
    expect(record.penalties).toBe(300);
    expect(record.advances).toBe(1000);
    expect(record.totalDeductions).toBe(1900);
    expect(record.netSalary).toBe(11900);
    expect(record.paidDaysCount).toBeUndefined();
    expect(record.dailyRateApplied).toBeUndefined();
  });

  it("never hardcodes — net follows gross minus every deduction bucket", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: AHMED,
      allowancesTotal: 500,
      approvedOvertimeAmount: 0,
      incentives: 250,
      bonuses: 750,
      lateMinutesTotal: 0,
      earlyLeaveMinutesTotal: 12,
      ...NO_DAYS,
      deductions: [ded("admin_deduction", 100), ded("other", 50)],
      settings: BASE_SETTINGS,
    });
    expect(record.grossSalary).toBe(12000 + 500 + 0 + 250 + 750);
    expect(record.earlyLeaveDeduction).toBe(60);
    expect(record.otherDeductions).toBe(150);
    expect(record.netSalary).toBe(record.grossSalary - record.totalDeductions);
    expect(record.totalDeductions).toBe(210);
  });

  it("rounds overtime to whole EGP", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: AHMED,
      allowancesTotal: 0,
      approvedOvertimeAmount: 799.6,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal: 0,
      earlyLeaveMinutesTotal: 0,
      ...NO_DAYS,
      deductions: [],
      settings: BASE_SETTINGS,
    });
    expect(record.overtimeAmount).toBe(800);
  });
});

describe("calculatePayrollRecord — daily", () => {
  it("pays worked days at the day rate, with no absence deduction", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: DAILY_WORKER,
      allowancesTotal: 200,
      approvedOvertimeAmount: 0,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal: 0,
      earlyLeaveMinutesTotal: 0,
      absenceDays: 5, // must be ignored for a daily worker
      paidDays: 22, // 22 * 400 = 8800
      deductions: [],
      settings: BASE_SETTINGS,
    });
    expect(record.basicSalary).toBe(8800); // base = paidDays * dailyRate
    expect(record.absenceDeduction).toBe(0);
    expect(record.grossSalary).toBe(8800 + 200);
    expect(record.netSalary).toBe(9000);
    expect(record.paidDaysCount).toBe(22);
    expect(record.dailyRateApplied).toBe(400);
  });

  it("still applies late and early-leave deductions", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: DAILY_WORKER,
      allowancesTotal: 0,
      approvedOvertimeAmount: 0,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal: 30, // 30 * 5 = 150
      earlyLeaveMinutesTotal: 10, // 10 * 5 = 50
      absenceDays: 0,
      paidDays: 20, // 20 * 400 = 8000
      deductions: [ded("advance", 500)],
      settings: BASE_SETTINGS,
    });
    expect(record.grossSalary).toBe(8000);
    expect(record.lateDeduction).toBe(150);
    expect(record.earlyLeaveDeduction).toBe(50);
    expect(record.advances).toBe(500);
    expect(record.totalDeductions).toBe(700);
    expect(record.netSalary).toBe(7300);
  });

  it("falls back to basicSalary / workingDaysPerMonth when dailyRate is unset", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: { ...DAILY_WORKER, dailyRate: undefined, basicSalary: 9000 },
      allowancesTotal: 0,
      approvedOvertimeAmount: 0,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal: 0,
      earlyLeaveMinutesTotal: 0,
      absenceDays: 0,
      paidDays: 10,
      deductions: [],
      settings: BASE_SETTINGS,
    });
    expect(record.dailyRateApplied).toBe(300); // 9000 / 30
    expect(record.basicSalary).toBe(3000); // 10 * 300
  });
});
