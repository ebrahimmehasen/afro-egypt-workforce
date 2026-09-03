import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { calculatePayrollRecord } from "@/lib/payroll-engine";

/**
 * Integration coverage that runs against a database seeded with the rich sample
 * dataset (`npm run db:seed:sample`). Skips automatically when the DB is
 * unreachable OR only the minimal production seed is loaded.
 */
const prisma = new PrismaClient();

let sampleLoaded = false;
try {
  sampleLoaded = (await prisma.employee.count()) >= 10;
} catch {
  sampleLoaded = false;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!sampleLoaded)("sample-seeded database", () => {
  it("has a full org (>=10 employees, 6 departments, 3 shifts)", async () => {
    expect(await prisma.employee.count({ where: { deletedAt: null } })).toBeGreaterThanOrEqual(10);
    expect(await prisma.department.count({ where: { deletedAt: null } })).toBe(6);
    expect(await prisma.shift.count({ where: { deletedAt: null } })).toBe(3);
  });

  it("every daily-attendance row points at a real employee and shift", async () => {
    const rows = await prisma.dailyAttendance.findMany({ include: { employee: true, shift: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.employee).toBeTruthy();
      expect(row.shift).toBeTruthy();
    }
  });

  it("every user's linked employee / department actually exists", async () => {
    const users = await prisma.user.findMany();
    for (const u of users) {
      if (u.employeeId) {
        expect(await prisma.employee.findUnique({ where: { id: u.employeeId } })).toBeTruthy();
      }
      if (u.departmentId) {
        expect(await prisma.department.findUnique({ where: { id: u.departmentId } })).toBeTruthy();
      }
    }
  });

  it("produces a coherent payroll record from a real employee's data", async () => {
    const employee = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null } });
    const [settings, attSettings, allowances, monthAttendance] = await Promise.all([
      prisma.payrollSettings.findUniqueOrThrow({ where: { id: "singleton" } }),
      prisma.attendanceSettings.findUniqueOrThrow({ where: { id: "singleton" } }),
      prisma.allowance.findMany({
        where: { employeeId: employee.id, type: { in: ["transport", "meal", "fixed"] } },
      }),
      prisma.dailyAttendance.findMany({ where: { employeeId: employee.id } }),
    ]);
    const allowancesTotal = allowances.reduce((s, a) => s + a.amount, 0);

    const record = calculatePayrollRecord("PP-TEST", {
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

    expect(record.grossSalary).toBe(record.basicSalary + allowancesTotal);
    expect(record.netSalary).toBe(record.grossSalary - record.totalDeductions);
    expect(record.netSalary).toBeLessThanOrEqual(record.grossSalary);
  });
});
