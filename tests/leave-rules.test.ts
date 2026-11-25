import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { NOTICE_HOURS, checkAnnualLeaveRequest } from "@/lib/leave-balance";

/**
 * The leave rules as agreed: an ordinary (annual) leave must be filed at least 48 hours before its first day; a casual
 * leave can be filed the same day and goes to the leaves list for review like any request; the other types behave as
 * they always did. These pin the rules that already exist (checkAnnualLeaveRequest, createLeave) — nothing here changes
 * them. The first half is pure; the second runs the real createLeave against the sample-seeded TEST database (skipped
 * anywhere else: the tests never use the production database, see tests/setup/db-guard.ts).
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { createLeave } = await import("@/lib/actions/leaves");
const { loadDayKindRule } = await import("@/lib/leave-days");

// ------------------------------------------------------------------------------------------------------- pure

describe("the 48-hour notice for an annual leave", () => {
  const base = { hireDate: "2020-01-01", leaves: [], absentDays: [] as string[] };

  it("is 48 hours", () => {
    expect(NOTICE_HOURS).toBe(48);
  });

  it("refuses an annual leave whose first day starts less than 48 hours from now", () => {
    // now: Wed 10 Jun 2026, 12:00 local. The 12th starts 36 hours away; the 11th and the 10th are even sooner.
    const now = new Date(2026, 5, 10, 12, 0, 0);
    for (const day of ["2026-06-10", "2026-06-11", "2026-06-12"]) {
      expect(checkAnnualLeaveRequest({ ...base, from: day, to: day, now })).toMatchObject({ ok: false, reason: "notice" });
    }
  });

  it("accepts it from 48 hours on: the 13th starts 60 hours away, and exactly 48 hours is enough", () => {
    expect(checkAnnualLeaveRequest({ ...base, from: "2026-06-13", to: "2026-06-13", now: new Date(2026, 5, 10, 12, 0, 0) })).toMatchObject({ ok: true });
    expect(checkAnnualLeaveRequest({ ...base, from: "2026-06-12", to: "2026-06-12", now: new Date(2026, 5, 10, 0, 0, 0) })).toMatchObject({ ok: true });
    expect(checkAnnualLeaveRequest({ ...base, from: "2026-06-12", to: "2026-06-12", now: new Date(2026, 5, 10, 0, 0, 1) })).toMatchObject({ ok: false, reason: "notice" });
  });
});

// ------------------------------------------------------------------------------------------------ real createLeave

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}

const EMP = "ZZ-LRL-001";
const ACTOR = "ZZ-leave-rules-test";
const pad = (n: number) => String(n).padStart(2, "0");
const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const file = (fields: Record<string, string>) => {
  const f = new FormData();
  f.set("employeeId", EMP);
  f.set("reason", "");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return createLeave({}, f);
};
const saved = () => prisma.leave.findMany({ where: { employeeId: EMP }, orderBy: { createdAt: "asc" } });
const clear = () => prisma.leave.deleteMany({ where: { employeeId: EMP } });

afterAll(async () => {
  if (sampleDb) {
    await clear();
    await prisma.employee.deleteMany({ where: { id: EMP } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("filing a leave", () => {
  let working: (day: string) => boolean = () => true;

  beforeAll(async () => {
    await clear();
    await prisma.employee.deleteMany({ where: { id: EMP } });
    session = { id: "U-lrl", name: ACTOR, email: "a@x", role: "admin", permissions: [] };
    const seed = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } });
    await prisma.employee.create({
      data: { id: EMP, employeeNumber: "ZZLRL-001", name: "اختبار قواعد الإجازات", departmentId: seed.departmentId, jobTitle: "x", hireDate: new Date("2020-01-01"), shiftId: seed.shiftId, basicSalary: 6000 },
    });
    const kindOf = await loadDayKindRule();
    working = (day) => kindOf(day) === "workday";
  });

  it("an annual leave filed less than 48 hours ahead is rejected, and nothing is saved", async () => {
    // the first working day among today, tomorrow and the day after: each starts less than 48 hours from now
    const day = [0, 1, 2].map(dayOffset).find(working);
    expect(day, "a working day within the next two days").toBeDefined();
    expect(await file({ type: "annual", from: day!, to: day! })).toEqual({ error: ar.leaves.balance.errNotice });
    expect(await saved()).toEqual([]);
  });

  it("an annual leave filed 48 hours or more ahead is accepted (the control for the rule above)", async (ctx) => {
    const thisYear = new Date().getFullYear();
    const day = [3, 4, 5, 6, 7, 8, 9, 10].map(dayOffset).find((d) => working(d) && Number(d.slice(0, 4)) === thisYear);
    if (!day) return ctx.skip(); // the end of the year: the balance is one calendar year's, so there is nothing to file
    const result = await file({ type: "annual", from: day, to: day });
    expect(result).toHaveProperty("success", true);
    const [row] = await saved();
    expect(row).toMatchObject({ type: "annual", status: "pending" });
    await clear();
  });

  it("a casual leave filed for today is accepted, and waits in the leaves list for review", async () => {
    const today = dayOffset(0);
    expect(await file({ type: "casual", from: today, to: today })).toHaveProperty("success", true);
    const [row] = await saved();
    expect(row).toMatchObject({ type: "casual", status: "pending", approvedBy: null });
    expect(row.from.toISOString().slice(0, 10)).toBe(today);
    // it is in the list the leaves page reads (getDb), as a pending request
    const { getDb } = await import("@/lib/data");
    expect((await getDb()).leaves.find((l) => l.id === row.id)).toMatchObject({ type: "casual", status: "pending" });
    await clear();
  });

  it("a casual leave for tomorrow is accepted too; it has no notice period", async () => {
    expect(await file({ type: "casual", from: dayOffset(1), to: dayOffset(1) })).toHaveProperty("success", true);
    await clear();
  });

  it("sick, unpaid, mission and excused absence are accepted the same day, as they were", async () => {
    const today = dayOffset(0);
    for (const type of ["sick", "unpaid", "mission", "excused_absence"]) {
      expect(await file({ type, from: today, to: today }), type).toHaveProperty("success", true);
    }
    expect((await saved()).map((l) => l.type).sort()).toEqual(["excused_absence", "mission", "sick", "unpaid"]);
    await clear();
  });

  it("a permission still needs its time and duration", async () => {
    const today = dayOffset(0);
    expect(await file({ type: "permission", from: today, to: today })).toHaveProperty("error", ar.leaves.errTimeRequired);
    expect(await saved()).toEqual([]);
  });
});
