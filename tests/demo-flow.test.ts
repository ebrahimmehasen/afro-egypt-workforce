import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { DEMO_EMPLOYEE_ID, DEMO_PERIOD_ID } from "@/lib/constants";

/**
 * End-to-end guard for the spec §55 acceptance story against the real database
 * + payroll engine. Skips automatically when no MySQL is reachable (e.g. CI
 * without a service, or a dev box before `prisma migrate`). Run the DB with
 * `docker compose up -d`, then `npm run db:migrate && npm run db:seed`.
 */
const prisma = new PrismaClient();

let dbUp = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbUp = true;
} catch {
  dbUp = false;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)("§55 story — against the seeded database", () => {
  it("has the full org seeded (50 employees, 6 departments, 3 shifts)", async () => {
    expect(await prisma.employee.count({ where: { deletedAt: null } })).toBe(50);
    expect(await prisma.department.count({ where: { deletedAt: null } })).toBe(6);
    expect(await prisma.shift.count({ where: { deletedAt: null } })).toBe(3);
    const period = await prisma.payrollPeriod.findUnique({ where: { id: DEMO_PERIOD_ID } });
    expect(period?.status).toBe("draft");
  });

  it("every daily-attendance row points at a real employee and shift", async () => {
    const rows = await prisma.dailyAttendance.findMany({
      include: { employee: true, shift: true },
    });
    for (const row of rows) {
      expect(row.employee).toBeTruthy();
      expect(row.shift).toBeTruthy();
    }
  });

  it("leaves Ahmed (EMP-1001) un-punched today so the live demo can tell the story", async () => {
    const logs = await prisma.attendanceLog.count({
      where: {
        employeeId: DEMO_EMPLOYEE_ID,
        timestamp: { gte: new Date("2026-08-21T00:00:00Z"), lt: new Date("2026-08-22T00:00:00Z") },
        source: { not: "biometric" },
      },
    });
    expect(logs).toBe(0);
  });

  it("produces a coherent payroll record for Ahmed from his real data", async () => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: DEMO_EMPLOYEE_ID } });
    const monthAttendance = await prisma.dailyAttendance.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: new Date("2026-08-01"), lt: new Date("2026-09-01") },
      },
    });
    const settings = await prisma.payrollSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const attSettings = await prisma.attendanceSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const allowances = await prisma.allowance.findMany({
      where: { employeeId: employee.id, type: { in: ["transport", "meal", "fixed"] } },
    });
    const allowancesTotal = allowances.reduce((s, a) => s + a.amount, 0);

    const record = calculatePayrollRecord(DEMO_PERIOD_ID, {
      employee: {
        id: employee.id,
        name: employee.name,
        departmentId: employee.departmentId,
        jobTitle: employee.jobTitle,
        hireDate: employee.hireDate.toISOString().slice(0, 10),
        shiftId: employee.shiftId,
        basicSalary: employee.basicSalary,
        allowances: employee.allowancesTotal,
        biometricDeviceUserId: employee.biometricDeviceUserId,
        status: employee.status,
      },
      allowancesTotal,
      approvedOvertimeAmount: 0,
      incentives: 0,
      bonuses: 0,
      lateMinutesTotal: monthAttendance.reduce((s, a) => s + a.deductibleLateMinutes, 0),
      absenceDays: monthAttendance.filter((a) => a.status === "absent").length,
      earlyLeaveMinutesTotal: 0,
      deductions: [],
      settings: {
        ...settings,
        lateDeductionPerMinute: attSettings.lateDeductionPerMinute,
        earlyLeaveDeductionPerMinute: attSettings.earlyLeaveDeductionPerMinute,
      },
    });

    expect(record.basicSalary).toBe(12000);
    expect(record.grossSalary).toBe(record.basicSalary + allowancesTotal);
    expect(record.netSalary).toBe(record.grossSalary - record.totalDeductions);
    expect(record.netSalary).toBeLessThanOrEqual(record.grossSalary);
  });
});
