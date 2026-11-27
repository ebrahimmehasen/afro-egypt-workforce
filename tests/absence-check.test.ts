import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import type { Scope } from "@/lib/scope";
import { absenceCheckDays, absenceReviewKey, canSeeAbsenceCheck } from "@/lib/absence-check";
import { addDays, today } from "@/lib/today";

/**
 * (a) absenceCheckDays, pure — scope, already-reviewed, unknown employee. No database.
 * (b) on the disposable TEST database (skipped elsewhere, see tests/setup/db-guard.ts): who sees the notification
 *     (admin, HR with/without "attendance", supervisor, employee), department scope, a day with an approved leave/
 *     mission (a different status, never "absent") is excluded, marking reviewed hides it, a recovered day drops
 *     out by itself, the PER_KIND cap in the bell, and that none of it ever touches a Daily/Overtime/Deduction/
 *     PayrollRecord row.
 */

describe("absenceCheckDays (pure)", () => {
  const scopeAll: Scope = { all: true };
  const employees = [{ id: "E1", name: "Hossam" }, { id: "E2", name: "Mona" }];

  it("lists an absent day for an employee in scope", () => {
    expect(absenceCheckDays({ rows: [{ employeeId: "E1", date: "2026-11-10" }], employees, scope: scopeAll, reviewed: new Set() })).toEqual([
      { employeeId: "E1", name: "Hossam", date: "2026-11-10" },
    ]);
  });

  it("leaves out an employee outside the viewer's scope", () => {
    const scope: Scope = { all: false, ids: new Set(["E2"]) };
    expect(absenceCheckDays({ rows: [{ employeeId: "E1", date: "2026-11-10" }], employees, scope, reviewed: new Set() })).toEqual([]);
  });

  it("leaves out a day already marked reviewed", () => {
    const reviewed = new Set([absenceReviewKey("E1", "2026-11-10")]);
    expect(absenceCheckDays({ rows: [{ employeeId: "E1", date: "2026-11-10" }], employees, scope: scopeAll, reviewed })).toEqual([]);
  });

  it("leaves out a row whose employee isn't in the given list (e.g. deleted)", () => {
    expect(absenceCheckDays({ rows: [{ employeeId: "E9", date: "2026-11-10" }], employees, scope: scopeAll, reviewed: new Set() })).toEqual([]);
  });

  it("canSeeAbsenceCheck: the admin and HR holding attendance, not a supervisor, staff or employee", () => {
    const u = (over: Partial<User>): User => ({ id: "u", name: "n", email: "n@x", role: "employee", permissions: [], ...over });
    expect(canSeeAbsenceCheck(u({ role: "admin" }))).toBe(true);
    expect(canSeeAbsenceCheck(u({ role: "hr", permissions: ["attendance"] }))).toBe(true);
    expect(canSeeAbsenceCheck(u({ role: "hr", permissions: ["leaves"] }))).toBe(false);
    expect(canSeeAbsenceCheck(u({ role: "supervisor", permissions: ["attendance"] }))).toBe(false);
    expect(canSeeAbsenceCheck(u({ role: "staff", permissions: ["attendance"] }))).toBe(false);
    expect(canSeeAbsenceCheck(u({ role: "employee" }))).toBe(false);
  });
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let session: User | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { loadAbsenceCheckForRange } = await import("@/lib/absence-check");
const { getNotifications } = await import("@/lib/notifications");
const { markAbsenceReviewed } = await import("@/lib/actions/absence-review");

const prisma = new PrismaClient();
let hasDb = false;
try {
  hasDb = (await prisma.absenceReview.count()) >= 0;
} catch {
  hasDb = false;
}

const TAG = "ZZ-ABS";
const ACTOR = `${TAG} actor`;
let deptA = "";
let deptB = "";
let shiftId = "";
let empA = "";
let empB = "";
// well inside REVIEW_WINDOW_DAYS, but outside the sample seed's own history window (DEMO_DATE-13..DEMO_DATE-1,
// see prisma/seed-sample.ts), so no randomly-seeded absence for another employee collides with this test's own.
const DAY = addDays(today(), -20);

let uid = 0;
const mk = (over: Partial<User>): User => ({ id: `${TAG}-u${++uid}`, name: ACTOR, email: `${TAG}${uid}@x`, role: "admin", permissions: [], ...over });
const admin = () => mk({ role: "admin" });
const hrWith = () => mk({ role: "hr", departmentIds: [deptA], permissions: ["attendance"] });
const hrWithout = () => mk({ role: "hr", departmentIds: [deptA], permissions: ["leaves"] });
const supervisor = () => mk({ role: "supervisor", departmentIds: [deptA], permissions: ["attendance"] });
const employee = () => mk({ role: "employee", employeeId: empA });

const absentRow = (employeeId: string, date: string) =>
  prisma.dailyAttendance.create({
    data: { employeeId, date: new Date(`${date}T00:00:00.000Z`), shiftId, scheduledStart: new Date(`${date}T08:00:00.000Z`), scheduledEnd: new Date(`${date}T18:00:00.000Z`), status: "absent" },
  });

async function cleanup() {
  await prisma.absenceReview.deleteMany({ where: { employee: { employeeNumber: { startsWith: TAG } } } });
  await prisma.dailyAttendance.deleteMany({ where: { employee: { employeeNumber: { startsWith: TAG } } } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  await prisma.employee.deleteMany({ where: { employeeNumber: { startsWith: TAG } } });
  await prisma.department.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  if (!hasDb) return;
  await cleanup();
  const shift = await prisma.shift.findFirstOrThrow();
  shiftId = shift.id;
  // soft-deleted on purpose: a real (not-deleted) one would make sample-seed.test.ts's exact department count flaky
  // against whatever else runs alongside this file, and a real department's own employees would compete with this
  // file's absent-day fixtures for the bell's PER_KIND slice. deletedAt here only hides it from that count — it's
  // still a perfectly usable foreign-key target for an employee's departmentId.
  const dept = (n: string) => prisma.department.create({ data: { name: `${TAG} ${n}`, deletedAt: new Date() } }).then((d) => d.id);
  deptA = await dept("A");
  deptB = await dept("B");
  const employeeRow = (n: string, departmentId: string) =>
    prisma.employee.create({ data: { employeeNumber: `${TAG}-${n}`, name: `${TAG} Employee ${n}`, departmentId, jobTitle: "x", hireDate: new Date("2018-01-01"), shiftId, basicSalary: 6000 } }).then((e) => e.id);
  empA = await employeeRow("A", deptA);
  empB = await employeeRow("B", deptB);
});

afterAll(async () => {
  if (hasDb) await cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  session = null;
  if (hasDb) {
    await prisma.absenceReview.deleteMany({ where: { employee: { employeeNumber: { startsWith: TAG } } } });
    await prisma.dailyAttendance.deleteMany({ where: { employee: { employeeNumber: { startsWith: TAG } } } });
    await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  }
});

describe.skipIf(!hasDb)("who sees an absent day, and department scope", () => {
  it("the admin and HR holding attendance see it; HR without it, a supervisor and the employee do not", async () => {
    await absentRow(empA, DAY);
    for (const [name, who, expected] of [
      ["admin", admin(), [empA]],
      ["hr-with", hrWith(), [empA]],
      ["hr-without", hrWithout(), []],
      ["supervisor", supervisor(), []],
      ["employee", employee(), []],
    ] as const) {
      const days = await loadAbsenceCheckForRange(who, DAY, DAY);
      expect(days.map((d) => d.employeeId), name).toEqual(expected);
    }
  });

  it("HR scoped to department A does not see department B's absence", async () => {
    await absentRow(empB, DAY);
    expect((await loadAbsenceCheckForRange(hrWith(), DAY, DAY)).map((d) => d.employeeId)).toEqual([]);
    expect((await loadAbsenceCheckForRange(admin(), DAY, DAY)).map((d) => d.employeeId)).toContain(empB);
  });
});

describe.skipIf(!hasDb)("a day with an approved leave or mission is never listed", () => {
  it("a status of leave/mission/excused_absence (never 'absent') is left out, exactly as the attendance engine already distinguishes them", async () => {
    await prisma.dailyAttendance.create({
      data: { employeeId: empA, date: new Date(`${DAY}T00:00:00.000Z`), shiftId, scheduledStart: new Date(`${DAY}T08:00:00.000Z`), scheduledEnd: new Date(`${DAY}T18:00:00.000Z`), status: "leave" },
    });
    expect(await loadAbsenceCheckForRange(admin(), DAY, DAY)).toEqual([]);
  });
});

describe.skipIf(!hasDb)("marking reviewed", () => {
  it("silences the day, and a second mark is a harmless no-op", async () => {
    await absentRow(empA, DAY);
    expect((await loadAbsenceCheckForRange(admin(), DAY, DAY)).map((d) => d.employeeId)).toEqual([empA]);

    const form = new FormData();
    form.set("employeeId", empA);
    form.set("date", DAY);
    form.set("note", "called, confirmed really absent");
    const who = admin();
    session = who;
    const result = await markAbsenceReviewed({}, form);
    expect(result.success).toBe(true);
    expect(await loadAbsenceCheckForRange(admin(), DAY, DAY)).toEqual([]);

    // marking it again changes nothing new
    const again = await markAbsenceReviewed({}, form);
    expect(again.success).toBe(true);
    expect(await prisma.absenceReview.count({ where: { employeeId: empA, date: new Date(`${DAY}T00:00:00.000Z`) } })).toBe(1);
  });

  it("is refused for HR without the attendance right, a supervisor, and an unauthenticated caller", async () => {
    await absentRow(empA, DAY);
    const form = new FormData();
    form.set("employeeId", empA);
    form.set("date", DAY);
    for (const who of [hrWithout(), supervisor(), null]) {
      session = who;
      const result = await markAbsenceReviewed({}, form);
      expect(result.error).toBeTruthy();
    }
    expect(await prisma.absenceReview.count({ where: { employeeId: empA } })).toBe(0);
  });

  it("writes exactly one audit entry, with the reviewer's note as the reason", async () => {
    await absentRow(empA, DAY);
    const form = new FormData();
    form.set("employeeId", empA);
    form.set("date", DAY);
    form.set("note", "left a message with the department head");
    session = admin();
    await markAbsenceReviewed({}, form);
    const entries = await prisma.auditLogEntry.findMany({ where: { userName: ACTOR } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: "left a message with the department head" });
  });
});

describe.skipIf(!hasDb)("a recovered day drops out by itself", () => {
  it("once the day stops being 'absent' (HR corrected the punches), the notification disappears with no AbsenceReview row needed", async () => {
    const row = await absentRow(empA, DAY);
    expect((await loadAbsenceCheckForRange(admin(), DAY, DAY)).map((d) => d.employeeId)).toEqual([empA]);
    await prisma.dailyAttendance.update({ where: { id: row.id }, data: { status: "present", actualIn: new Date(`${DAY}T08:00:00.000Z`), actualOut: new Date(`${DAY}T18:00:00.000Z`) } });
    expect(await loadAbsenceCheckForRange(admin(), DAY, DAY)).toEqual([]);
  });
});

describe.skipIf(!hasDb)("zero effect on calculations", () => {
  it("reading the list and marking a day reviewed changes no Daily/Overtime/Deduction/PayrollRecord row", async () => {
    const row = await absentRow(empA, DAY);
    const snapshot = async () => ({
      daily: await prisma.dailyAttendance.findUniqueOrThrow({ where: { id: row.id } }),
      overtime: await prisma.overtime.count({ where: { employeeId: empA } }),
      deductions: await prisma.deduction.count({ where: { employeeId: empA } }),
      payroll: await prisma.payrollRecord.count({ where: { employeeId: empA } }),
    });
    const before = await snapshot();

    await loadAbsenceCheckForRange(admin(), DAY, DAY);
    const form = new FormData();
    form.set("employeeId", empA);
    form.set("date", DAY);
    session = admin();
    await markAbsenceReviewed({}, form);

    const after = await snapshot();
    expect(after.daily).toEqual(before.daily);
    expect(after.overtime).toBe(before.overtime);
    expect(after.deductions).toBe(before.deductions);
    expect(after.payroll).toBe(before.payroll);
  });
});

describe.skipIf(!hasDb)("the bell (notifications.ts)", () => {
  it("shows an absence-check item with its attendance link and a second link to the employee's profile", async () => {
    await absentRow(empA, DAY);
    // scoped to the test's own department: company-wide (admin) competes for the PER_KIND slice against whatever
    // the sample data happens to have absent "today", which this test has no control over
    const feed = await getNotifications(hrWith());
    const item = feed.items.find((n) => n.id === `absence-check-${empA}-${DAY}`);
    expect(item).toBeTruthy();
    expect(item?.href).toBe(`/attendance?date=${DAY}`);
    expect(item?.secondaryHref).toBe(`/employees/${empA}`);
    expect(item?.actionable).toBe(true);
  });

  it("caps the listed items at PER_KIND (5) even though pendingCount reflects every one", async () => {
    const extra: string[] = [];
    for (let i = 0; i < 6; i++) {
      const e = await prisma.employee.create({
        data: { employeeNumber: `${TAG}-N${i}`, name: `${TAG} N${i}`, departmentId: deptA, jobTitle: "x", hireDate: new Date("2018-01-01"), shiftId, basicSalary: 6000 },
      });
      extra.push(e.id);
      await absentRow(e.id, DAY);
    }
    const feed = await getNotifications(hrWith());
    const items = feed.items.filter((n) => n.id.startsWith("absence-check-"));
    expect(items).toHaveLength(5);
    expect(feed.pendingCount).toBeGreaterThanOrEqual(6);
    await prisma.dailyAttendance.deleteMany({ where: { employeeId: { in: extra } } });
    await prisma.employee.deleteMany({ where: { id: { in: extra } } });
  });
});
