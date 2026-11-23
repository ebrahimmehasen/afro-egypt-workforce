import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { annualLeaveBalance } from "@/lib/leave-balance";

/**
 * Filing and deciding a permission with a time, through the real createLeave / decideLeave on the sample-seeded
 * dev database; skipped anywhere else.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/attendance-effects", () => ({ scheduleAttendanceEffects: () => {} }));
vi.mock("@/lib/attendance-service", () => ({ recalculateRange: async () => 0 }));

const { createLeave, decideLeave } = await import("@/lib/actions/leaves");
const { loadPayContext, scheduleFor } = await import("@/lib/pay-context");

const prisma = new PrismaClient();
let sampleDb = false;
let employeeId = "";
let start = "08:00";
let end = "18:00";
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
  if (sampleDb) {
    const employee = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } });
    employeeId = employee.id;
    const schedule = scheduleFor(await loadPayContext(), employee);
    start = schedule.start;
    end = schedule.end;
  }
} catch {
  sampleDb = false;
}
// a working day (a Monday) no other test uses, so the cleanup only ever removes this file's rows
const DAY = "2030-03-11";
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const cleanUp = () => prisma.leave.deleteMany({ where: { employeeId, from: new Date(`${DAY}T00:00:00Z`) } });
const file = (startTime: string, durationMinutes: number | "") => {
  const f = new FormData();
  f.set("employeeId", employeeId);
  f.set("type", "permission");
  f.set("from", DAY);
  f.set("to", DAY);
  f.set("startTime", startTime);
  f.set("durationMinutes", String(durationMinutes));
  return createLeave({}, f);
};
const saved = () => prisma.leave.findMany({ where: { employeeId, from: new Date(`${DAY}T00:00:00Z`) }, orderBy: { createdAt: "asc" } });

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("filing a permission with a time", () => {
  beforeEach(async () => {
    await cleanUp();
    session = { id: "U-admin", name: "timed-permission-test", email: "a@x", role: "admin", permissions: [] };
  });

  it("is saved for one day with its time and duration, waiting for a decision", async () => {
    const leaveAt = hhmm(minutes(start) + 120);
    expect(await file(leaveAt, 60)).toMatchObject({ success: true });
    const [row] = await saved();
    expect(row).toMatchObject({ type: "permission", startTime: leaveAt, durationMinutes: 60, status: "pending", reason: "" });
    expect(row.to.toISOString().slice(0, 10)).toBe(DAY);
  });

  it("without a time or duration, outside the employee's hours, or with no duration, is refused", async () => {
    expect(await file("", "")).toHaveProperty("error");
    expect(await file(hhmm(minutes(start) - 60), 30)).toHaveProperty("error");
    expect(await file(end, 30)).toHaveProperty("error");
    expect(await file(hhmm(minutes(start) + 60), 0)).toHaveProperty("error");
    expect(await saved()).toHaveLength(0);
  });

  it("two overlapping permissions on the same day are refused", async () => {
    expect(await file(hhmm(minutes(start) + 120), 60)).toMatchObject({ success: true });
    expect(await file(hhmm(minutes(start) + 150), 60)).toHaveProperty("error");
    expect(await file(hhmm(minutes(start) + 180), 30)).toMatchObject({ success: true });
    expect(await saved()).toHaveLength(2);
  });

  it("a supervisor can't decide it; the admin can", async () => {
    expect(await file(hhmm(minutes(start) + 120), 60)).toMatchObject({ success: true });
    const [row] = await saved();
    session = { id: "U-sup", name: "timed-permission-test", email: "s@x", role: "supervisor", permissions: ["leaves"] };
    expect(await decideLeave(row.id, "approved")).toHaveProperty("error");
    expect((await prisma.leave.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("pending");
    session = { id: "U-admin", name: "timed-permission-test", email: "a@x", role: "admin", permissions: [] };
    expect(await decideLeave(row.id, "approved")).toMatchObject({ success: true });
    expect((await prisma.leave.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("approved");
  });
});

describe("a permission takes nothing from the annual-leave balance", () => {
  it("an approved permission, timed or not, leaves the balance as it was", () => {
    const kindOf = () => "workday" as const;
    const without = annualLeaveBalance({ hireDate: "2020-01-01", leaves: [], absentDays: [], asOf: "2026-09-30", kindOf });
    const withPermission = annualLeaveBalance({
      hireDate: "2020-01-01",
      leaves: [{ type: "permission", status: "approved", from: "2026-09-21", to: "2026-09-21" }],
      absentDays: [],
      asOf: "2026-09-30",
      kindOf,
    });
    expect(withPermission).toEqual(without);
  });
});
