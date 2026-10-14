import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { calculatePeriodRecords } from "@/lib/payroll-recalc";
import { getDictionary } from "@/lib/i18n";

/**
 * The payroll recalculation the background refresh runs: it rebuilds a calculated period's records from what is
 * on file (so a deduction posted after "حساب الرواتب" shows up), and never touches an approved or closed period.
 * Uses throw-away periods in 2099 on the local sample database; skipped when no database is reachable.
 */
const prisma = new PrismaClient();
const t = getDictionary("ar");
const LABEL = "TEST-PAYROLL-RECALC-2099";

let ready = false;
let employeeId = "";
try {
  const e = await prisma.employee.findFirst({ where: { deletedAt: null, status: "active" } });
  if (e) {
    employeeId = e.id;
    ready = true;
  }
} catch {
  ready = false;
}

async function cleanup() {
  const periods = await prisma.payrollPeriod.findMany({ where: { year: 2099 } });
  await prisma.payrollRecord.deleteMany({ where: { periodId: { in: periods.map((p) => p.id) } } });
  await prisma.payrollPeriod.deleteMany({ where: { year: 2099 } });
  await prisma.deduction.deleteMany({ where: { reason: LABEL } });
  await prisma.auditLogEntry.deleteMany({ where: { reason: LABEL } });
}

afterAll(async () => {
  if (ready) await cleanup();
  await prisma.$disconnect();
});

describe.skipIf(!ready)("calculatePeriodRecords", () => {
  it("rebuilds a calculated period and picks up a deduction added after the first calculation", async () => {
    await cleanup();
    const period = await prisma.payrollPeriod.create({ data: { label: LABEL, year: 2099, month: 1, status: "calculated" } });
    expect(await calculatePeriodRecords(period.id, "test", t, { onlyIf: ["calculated"] })).toBe("done");
    const before = await prisma.payrollRecord.findFirstOrThrow({ where: { periodId: period.id, employeeId } });

    // a deduction posted after the calculation, inside the period's pay month (26 Dec 2098 .. 25 Jan 2099)
    await prisma.deduction.create({ data: { employeeId, type: "penalty", amount: 123, date: new Date("2099-01-10T00:00:00Z"), reason: LABEL } });
    expect(await calculatePeriodRecords(period.id, "test", t, { onlyIf: ["calculated"] })).toBe("done");
    const after = await prisma.payrollRecord.findFirstOrThrow({ where: { periodId: period.id, employeeId } });
    expect(after.totalDeductions - before.totalDeductions).toBe(123);
    expect(after.netSalary).toBe(before.netSalary - 123);
    expect((await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe("calculated");
  });

  it("never touches an approved period", async () => {
    const period = await prisma.payrollPeriod.create({ data: { label: LABEL, year: 2099, month: 2, status: "approved" } });
    await prisma.payrollRecord.create({
      data: {
        periodId: period.id, employeeId, basicSalary: 1, allowances: 0, overtimeAmount: 0, incentives: 0, bonuses: 0, grossSalary: 1,
        lateDeduction: 0, absenceDeduction: 0, earlyLeaveDeduction: 0, penalties: 0, advances: 0, otherDeductions: 0, totalDeductions: 0, netSalary: 1,
      },
    });
    expect(await calculatePeriodRecords(period.id, "test", t, { onlyIf: ["calculated"] })).toBe("skipped");
    const records = await prisma.payrollRecord.findMany({ where: { periodId: period.id } });
    expect(records).toHaveLength(1);
    expect(records[0].netSalary).toBe(1);
    expect((await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe("approved");
  });

  it("never touches a closed period, whatever the caller allows", async () => {
    const period = await prisma.payrollPeriod.create({ data: { label: LABEL, year: 2099, month: 3, status: "closed" } });
    expect(await calculatePeriodRecords(period.id, "test", t)).toBe("closed");
    expect(await prisma.payrollRecord.count({ where: { periodId: period.id } })).toBe(0);
  });

  it("the automatic refresh skips a draft period (nothing calculated yet)", async () => {
    const period = await prisma.payrollPeriod.create({ data: { label: LABEL, year: 2099, month: 4, status: "draft" } });
    expect(await calculatePeriodRecords(period.id, "test", t, { onlyIf: ["calculated"] })).toBe("skipped");
    expect(await prisma.payrollRecord.count({ where: { periodId: period.id } })).toBe(0);
  });
});
