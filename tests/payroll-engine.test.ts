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
  basicSalary: 12000,
  allowances: 1000,
  biometricDeviceUserId: "1001",
  status: "active",
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

describe("calculatePayrollRecord", () => {
  it("reproduces the spec §30 demo example (net = 11,900 EGP)", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: AHMED,
      allowancesTotal: 1000,
      approvedOvertimeAmount: 800,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal: 40, // 40 * 5 = 200
      absenceDays: 1, // 1 * (12000 / 30) = 400
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
  });

  it("never hardcodes — net follows gross minus every deduction bucket", () => {
    const record = calculatePayrollRecord("PP-2026-08", {
      employee: AHMED,
      allowancesTotal: 500,
      approvedOvertimeAmount: 0,
      incentives: 250,
      bonuses: 750,
      lateMinutesTotal: 0,
      absenceDays: 0,
      earlyLeaveMinutesTotal: 12,
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
      absenceDays: 0,
      earlyLeaveMinutesTotal: 0,
      deductions: [],
      settings: BASE_SETTINGS,
    });
    expect(record.overtimeAmount).toBe(800);
  });
});
