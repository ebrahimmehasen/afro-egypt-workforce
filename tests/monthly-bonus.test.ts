import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A one-off bonus (monthly = false) must be picked up by payroll only in its
 * target month — the same OR filter `calculatePayroll` uses. Skips without a DB.
 */
const prisma = new PrismaClient();

let dbUp = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbUp = true;
} catch {
  dbUp = false;
}

const BONUS_ID = "ALW-TEST-BONUS";
const EMP = "EMP-1001";

beforeAll(async () => {
  if (!dbUp) return;
  await prisma.allowance.deleteMany({ where: { id: BONUS_ID } });
  await prisma.allowance.create({
    data: {
      id: BONUS_ID,
      employeeId: EMP,
      type: "bonus",
      amount: 1500,
      monthly: false,
      effectiveYear: 2026,
      effectiveMonth: 8,
    },
  });
});

afterAll(async () => {
  if (dbUp) await prisma.allowance.deleteMany({ where: { id: BONUS_ID } });
  await prisma.$disconnect();
});

function periodFilter(year: number, month: number) {
  return {
    employeeId: EMP,
    OR: [
      { monthly: true },
      { monthly: false, effectiveYear: year, effectiveMonth: month },
    ],
  };
}

describe.skipIf(!dbUp)("one-off bonus is month-scoped", () => {
  it("is included when calculating its target month (Aug 2026)", async () => {
    const rows = await prisma.allowance.findMany({ where: periodFilter(2026, 8) });
    expect(rows.some((r) => r.id === BONUS_ID)).toBe(true);
  });

  it("is excluded from every other month", async () => {
    const sep = await prisma.allowance.findMany({ where: periodFilter(2026, 9) });
    const nextAug = await prisma.allowance.findMany({ where: periodFilter(2027, 8) });
    expect(sep.some((r) => r.id === BONUS_ID)).toBe(false);
    expect(nextAug.some((r) => r.id === BONUS_ID)).toBe(false);
  });

  it("recurring allowances are still returned every month", async () => {
    const rows = await prisma.allowance.findMany({ where: periodFilter(2026, 9) });
    expect(rows.some((r) => r.monthly)).toBe(true);
  });
});
