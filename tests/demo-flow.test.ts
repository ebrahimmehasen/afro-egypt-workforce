import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/store";
import { ensureSeeded } from "@/lib/seed";
import { recalculateDailyAttendance } from "@/lib/attendance-service";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { DEMO_DATE, DEMO_EMPLOYEE_ID, DEMO_PERIOD_ID } from "@/lib/constants";

/**
 * End-to-end guard for the spec §55 acceptance story, exercised against the real
 * seed + attendance service + payroll engine (no HTTP / next-headers layer).
 * When the data layer moves to the database this file is the checklist to port.
 */
beforeAll(() => {
  ensureSeeded();
});

describe("seed integrity", () => {
  it("creates the full org (50 employees, 6 departments, 3 shifts)", () => {
    expect(db.employees).toHaveLength(50);
    expect(db.departments).toHaveLength(6);
    expect(db.shifts).toHaveLength(3);
    expect(db.payrollPeriods.find((p) => p.id === DEMO_PERIOD_ID)?.status).toBe("draft");
  });

  it("every daily-attendance row points at a real employee and shift", () => {
    const empIds = new Set(db.employees.map((e) => e.id));
    const shiftIds = new Set(db.shifts.map((s) => s.id));
    for (const row of db.dailyAttendance) {
      expect(empIds.has(row.employeeId)).toBe(true);
      expect(shiftIds.has(row.shiftId)).toBe(true);
    }
  });

  it("leaves Ahmed (EMP-1001) un-punched today so the live demo can tell the story", () => {
    const today = db.dailyAttendance.find(
      (a) => a.employeeId === DEMO_EMPLOYEE_ID && a.date === DEMO_DATE,
    );
    expect(today).toBeUndefined();
  });

  it("keeps the audit log sorted newest-first", () => {
    const times = db.auditLog.map((e) => new Date(e.timestamp).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });
});

describe("§55 story — record Ahmed's punches then run payroll", () => {
  it("recalculates Ahmed to 'late' after a late check-in and a normal check-out", () => {
    db.attendanceLogs.push(
      {
        id: `LOG-TEST-IN`,
        employeeId: DEMO_EMPLOYEE_ID,
        deviceId: "ZK-DEMO-01",
        timestamp: `${DEMO_DATE}T08:45:00`,
        punchType: "in",
        source: "simulated",
      },
      {
        id: `LOG-TEST-OUT`,
        employeeId: DEMO_EMPLOYEE_ID,
        deviceId: "ZK-DEMO-01",
        timestamp: `${DEMO_DATE}T16:05:00`,
        punchType: "out",
        source: "simulated",
      },
    );

    const record = recalculateDailyAttendance(DEMO_EMPLOYEE_ID, DEMO_DATE);
    expect(record).not.toBeNull();
    expect(record!.status).toBe("late");
    expect(record!.deductibleLateMinutes).toBe(35); // 45 late - 10 grace
  });

  it("produces a coherent payroll record for Ahmed from his real data", () => {
    const employee = db.employees.find((e) => e.id === DEMO_EMPLOYEE_ID)!;
    const prefix = "2026-08";
    const monthAttendance = db.dailyAttendance.filter(
      (a) => a.employeeId === employee.id && a.date.startsWith(prefix),
    );
    const lateMinutesTotal = monthAttendance.reduce((s, a) => s + a.deductibleLateMinutes, 0);
    const absenceDays = monthAttendance.filter((a) => a.status === "absent").length;
    const allowances = db.allowances
      .filter((a) => a.employeeId === employee.id && ["transport", "meal", "fixed"].includes(a.type))
      .reduce((s, a) => s + a.amount, 0);

    const record = calculatePayrollRecord(DEMO_PERIOD_ID, {
      employee,
      allowancesTotal: allowances,
      approvedOvertimeAmount: 0,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal,
      absenceDays,
      earlyLeaveMinutesTotal: 0,
      deductions: [],
      settings: {
        ...db.payrollSettings,
        lateDeductionPerMinute: db.attendanceSettings.lateDeductionPerMinute,
        earlyLeaveDeductionPerMinute: db.attendanceSettings.earlyLeaveDeductionPerMinute,
      },
    });

    expect(record.basicSalary).toBe(12000);
    expect(record.grossSalary).toBe(record.basicSalary + allowances);
    expect(record.netSalary).toBe(record.grossSalary - record.totalDeductions);
    expect(record.netSalary).toBeLessThanOrEqual(record.grossSalary);
  });
});
