import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { recordChangeAs } from "@/lib/audit";

/**
 * The audit chokepoint (spec §46): every state change and its audit row land in
 * the same transaction — both, or neither. Runs against the dev database; skips
 * automatically when it is unreachable.
 */
const prisma = new PrismaClient();

let dbUp = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbUp = true;
} catch {
  dbUp = false;
}

const TEST_DEPT = "DEP-AUDIT-TEST";

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbUp)("recordChangeAs", () => {
  beforeEach(async () => {
    await prisma.auditLogEntry.deleteMany({ where: { module: "test-module" } });
    await prisma.department.deleteMany({ where: { id: TEST_DEPT } });
  });
  afterEach(async () => {
    await prisma.auditLogEntry.deleteMany({ where: { module: "test-module" } });
    await prisma.department.deleteMany({ where: { id: TEST_DEPT } });
  });

  it("writes the change and a matching audit row together", async () => {
    await recordChangeAs(
      "Tester",
      { module: "test-module", action: "create", newValue: TEST_DEPT },
      (tx) => tx.department.create({ data: { id: TEST_DEPT, name: "Audit Test", managerName: "N/A" } }),
    );

    expect(await prisma.department.findUnique({ where: { id: TEST_DEPT } })).toBeTruthy();
    const audit = await prisma.auditLogEntry.findFirst({ where: { module: "test-module" } });
    expect(audit).toMatchObject({ userName: "Tester", action: "create", newValue: TEST_DEPT });
  });

  it("rolls the audit row back when the write throws", async () => {
    await expect(
      recordChangeAs("Tester", { module: "test-module", action: "create" }, async (tx) => {
        await tx.department.create({ data: { id: TEST_DEPT, name: "Audit Test", managerName: "N/A" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await prisma.department.findUnique({ where: { id: TEST_DEPT } })).toBeNull();
    expect(await prisma.auditLogEntry.count({ where: { module: "test-module" } })).toBe(0);
  });
});
