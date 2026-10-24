import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";

/**
 * A leave or excuse can be filed without a reason (saved as ""); one given is kept as typed (trimmed).
 * Runs the real createLeave on the sample-seeded dev database; skipped anywhere else.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/attendance-effects", () => ({ scheduleAttendanceEffects: () => {} }));
vi.mock("@/lib/attendance-service", () => ({ recalculateRange: async () => 0 }));

const { createLeave } = await import("@/lib/actions/leaves");

const prisma = new PrismaClient();
let sampleDb = false;
let employeeId = "";
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
  if (sampleDb) employeeId = (await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } })).id;
} catch {
  sampleDb = false;
}
// a day no other test uses, so the cleanup only ever removes this file's rows
const DAY = "2030-03-05";
const cleanUp = () => prisma.leave.deleteMany({ where: { employeeId, from: new Date(`${DAY}T00:00:00Z`) } });
const file = (type: string, reason?: string) => {
  const f = new FormData();
  f.set("employeeId", employeeId);
  f.set("type", type);
  f.set("from", DAY);
  f.set("to", DAY);
  if (reason !== undefined) f.set("reason", reason);
  return createLeave({}, f);
};
const saved = () => prisma.leave.findMany({ where: { employeeId, from: new Date(`${DAY}T00:00:00Z`) }, orderBy: { createdAt: "asc" } });

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("the reason on a leave or excuse is optional", () => {
  beforeEach(async () => {
    await cleanUp();
    session = { id: "U-admin", name: "leave-reason-test", email: "a@x", role: "admin", permissions: [] };
  });

  it("an excuse or a sick leave without a reason — left out or blank — is filed, with an empty reason", async () => {
    expect(await file("excused_absence")).toMatchObject({ success: true });
    expect(await file("sick", "   ")).toMatchObject({ success: true });
    expect((await saved()).map((l) => [l.type, l.reason, l.status])).toEqual([
      ["excused_absence", "", "pending"],
      ["sick", "", "pending"],
    ]);
  });

  it("a reason given is kept, trimmed", async () => {
    expect(await file("mission", "  زيارة عميل  ")).toMatchObject({ success: true });
    expect((await saved())[0].reason).toBe("زيارة عميل");
  });
});
