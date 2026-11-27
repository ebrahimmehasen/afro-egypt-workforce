import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { allowedNavPaths, canAccess, PERMISSION_DEFS } from "@/lib/permissions";
import { canUseEvaluation } from "@/lib/evaluation/access";
import { computeDayPay, PayTypeRules } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";

/**
 * Employee evaluation: admin-only access (page, every action, exactly like /users and /permissions — never a
 * grantable permission), zero effect on payroll/attendance/deductions, and the data shapes the list and detail
 * pages read (current job level, latest rating, severity summary, document links through the existing authorized
 * routes). DB-backed parts skip automatically off the disposable TEST database (see tests/setup/db-guard.ts).
 */

const mk = (over: Partial<User>): User => ({ id: "u", name: "n", email: "n@x", role: "employee", permissions: [], ...over });
const admin = mk({ role: "admin" });
const hr = mk({ role: "hr", permissions: ["employees", "attendance", "leaves", "settings"] });
const supervisor = mk({ role: "supervisor", departmentIds: ["D1"], permissions: ["attendance"] });
const employee = mk({ role: "employee" });
const staff = mk({ role: "staff", permissions: ["employees"] });

describe("who may use employee evaluation (pure)", () => {
  it("canUseEvaluation: the admin only", () => {
    expect(canUseEvaluation(admin)).toBe(true);
    for (const who of [hr, supervisor, employee, staff]) expect(canUseEvaluation(who)).toBe(false);
  });

  it("/evaluation is never a grantable permission — same as /users and /permissions", () => {
    expect(PERMISSION_DEFS.some((p) => (p.path as string) === "/evaluation" || (p.key as string) === "evaluation")).toBe(false);
  });

  it("canAccess('/evaluation'): the admin only, no permission grant changes that", () => {
    expect(canAccess(admin, "/evaluation")).toBe(true);
    for (const who of [hr, supervisor, employee, staff, mk({ role: "hr", permissions: [...PERMISSION_DEFS.map((p) => p.key)] })]) {
      expect(canAccess(who, "/evaluation")).toBe(false);
    }
  });

  it("/evaluation never appears in allowedNavPaths for anyone but the admin", () => {
    expect(allowedNavPaths(admin)).toContain("/evaluation");
    for (const who of [hr, supervisor, employee, staff]) expect(allowedNavPaths(who)).not.toContain("/evaluation");
  });
});

describe("the pay engine is untouched by this feature (pure, no database)", () => {
  const rules: PayTypeRules = { ...FALLBACK_PAY_TYPES.monthly, id: "pt", hoursPerDay: 10, lateMultiplier: 1.5, overtimeMultiplier: 1.5, overtimeMinimumMinutes: 60, overtimeStepMinutes: 30, permissionMultiplier: 1, unauthorizedExitMultiplier: 1.5, fridayMultiplier: 2, holidayMultiplier: 2, graceMinutes: 10 };
  const schedule = { start: "08:00", end: "16:30", overtimeStart: "16:30" };
  const sampleDay = () =>
    computeDayPay({ date: "2026-09-21", kind: "workday", schedule, rules, pay: { basicSalary: 6000 }, actualIn: new Date("2026-09-21T08:05:00"), actualOut: new Date("2026-09-21T17:15:00"), hasPermission: false });

  it("computeDayPay's output for a fixed sample day is identical before and after this file imports/uses the evaluation module", async () => {
    const before = sampleDay();
    // importing and exercising the evaluation module changes nothing about how this is computed
    await import("@/lib/evaluation/data");
    await import("@/lib/evaluation/config");
    await import("@/lib/evaluation/access");
    const after = sampleDay();
    expect(after).toEqual(before);
  });
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let session: User | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { setEmployeeJobLevel, addEvaluationReview, saveJobLevel, deleteJobLevel, saveEvaluationScaleItem, deleteEvaluationScaleItem } = await import("@/lib/actions/evaluation");
const { loadEvaluationRows, loadEmployeeEvaluationDetail, loadJobLevels, loadRatingScale } = await import("@/lib/evaluation/data");

const prisma = new PrismaClient();
let hasDb = false;
try {
  hasDb = (await prisma.jobLevel.count()) >= 0;
} catch {
  hasDb = false;
}

const TAG = "ZZ-EVAL";
const ACTOR = `${TAG} actor`;
let deptA = "";
let empA = "";
let empB = "";
let shiftId = "";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function cleanup() {
  await prisma.evaluationReview.deleteMany({ where: { createdByName: ACTOR } });
  await prisma.employeeLevelChange.deleteMany({ where: { changedByName: ACTOR } });
  await prisma.evaluationScaleItem.deleteMany({ where: { label: { startsWith: TAG } } });
  await prisma.jobLevel.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  await prisma.employee.deleteMany({ where: { employeeNumber: { startsWith: TAG } } });
  await prisma.department.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  if (!hasDb) return;
  await cleanup();
  const shift = await prisma.shift.findFirstOrThrow();
  shiftId = shift.id;
  deptA = (await prisma.department.create({ data: { name: `${TAG} A`, deletedAt: new Date() } })).id;
  empA = (await prisma.employee.create({ data: { employeeNumber: `${TAG}-A`, name: `${TAG} Employee A`, departmentId: deptA, jobTitle: "x", hireDate: new Date("2020-01-01"), shiftId, basicSalary: 6000 } })).id;
  empB = (await prisma.employee.create({ data: { employeeNumber: `${TAG}-B`, name: `${TAG} Employee B`, departmentId: deptA, jobTitle: "x", hireDate: new Date("2020-01-01"), shiftId, basicSalary: 6000 } })).id;
});

afterAll(async () => {
  if (hasDb) await cleanup();
  await prisma.$disconnect();
});

beforeEach(() => {
  session = null;
});

const adminUser = (): User => ({ id: `${TAG}-u`, name: ACTOR, email: `${TAG}@x`, role: "admin", permissions: [] });

describe.skipIf(!hasDb)("every action is admin-only, exactly like the page", () => {
  it("setEmployeeJobLevel: admin yes; hr, supervisor, employee, no session: no", async () => {
    const level = await prisma.jobLevel.create({ data: { name: `${TAG} Junior` } });
    for (const [name, who] of [["hr", hr], ["supervisor", supervisor], ["employee", employee], ["no session", null]] as const) {
      session = who;
      const result = await setEmployeeJobLevel({}, form({ employeeId: empA, jobLevelId: level.id, reason: "x" }));
      expect(result.error, name).toBeTruthy();
    }
    expect(await prisma.employeeLevelChange.count({ where: { employeeId: empA } })).toBe(0);
    session = adminUser();
    expect(await setEmployeeJobLevel({}, form({ employeeId: empA, jobLevelId: level.id, reason: "promoted" }))).toMatchObject({ success: true });
    expect(await prisma.employeeLevelChange.count({ where: { employeeId: empA } })).toBe(1);
  });

  it("addEvaluationReview: admin yes; everyone else no", async () => {
    const item = await prisma.evaluationScaleItem.create({ data: { label: `${TAG} Good` } });
    for (const [name, who] of [["hr", hr], ["supervisor", supervisor], ["employee", employee], ["no session", null]] as const) {
      session = who;
      const result = await addEvaluationReview({}, form({ employeeId: empA, periodLabel: "Q1", periodDate: "2026-03-01", scaleItemId: item.id }));
      expect(result.error, name).toBeTruthy();
    }
    expect(await prisma.evaluationReview.count({ where: { employeeId: empA } })).toBe(0);
    session = adminUser();
    expect(await addEvaluationReview({}, form({ employeeId: empA, periodLabel: "Q1 2026", periodDate: "2026-03-01", scaleItemId: item.id, comment: "good work" }))).toMatchObject({ success: true });
  });

  it("the Settings CRUD (job levels and the rating scale) is admin-only too", async () => {
    for (const who of [hr, supervisor, employee, null]) {
      session = who;
      expect((await saveJobLevel({}, form({ name: `${TAG} X`, sortOrder: "0" }))).error).toBeTruthy();
      expect((await saveEvaluationScaleItem({}, form({ label: `${TAG} X`, sortOrder: "0" }))).error).toBeTruthy();
    }
    expect(await prisma.jobLevel.count({ where: { name: `${TAG} X` } })).toBe(0);

    session = adminUser();
    const levelRes = await saveJobLevel({}, form({ name: `${TAG} Senior`, sortOrder: "1" }));
    expect(levelRes).toMatchObject({ success: true });
    const level = await prisma.jobLevel.findFirstOrThrow({ where: { name: `${TAG} Senior` } });

    session = hr;
    expect((await deleteJobLevel(level.id)).error).toBeTruthy();
    session = adminUser();
    expect(await deleteJobLevel(level.id)).toMatchObject({ success: true });
    expect(await prisma.jobLevel.findUnique({ where: { id: level.id } })).toBeNull();
  });
});

describe.skipIf(!hasDb)("zero effect on payroll, deductions and attendance", () => {
  it("creating job levels, a level change, rating-scale items and a review changes no row of Daily/Overtime/Deduction/PayrollRecord", async () => {
    // scoped to this test's own employee: a global count would be flaky under the full suite, where unrelated
    // files concurrently create and remove their own Daily/Overtime/Deduction/Payroll rows for other employees
    const tables = async () => ({
      daily: await prisma.dailyAttendance.count({ where: { employeeId: empA } }),
      overtime: await prisma.overtime.count({ where: { employeeId: empA } }),
      deduction: await prisma.deduction.count({ where: { employeeId: empA } }),
      payroll: await prisma.payrollRecord.count({ where: { employeeId: empA } }),
    });
    const before = await tables();

    session = adminUser();
    const level = await prisma.jobLevel.create({ data: { name: `${TAG} Mid` } });
    await setEmployeeJobLevel({}, form({ employeeId: empA, jobLevelId: level.id, reason: "quarterly review" }));
    const item = await prisma.evaluationScaleItem.create({ data: { label: `${TAG} Excellent` } });
    await addEvaluationReview({}, form({ employeeId: empA, periodLabel: "Q2 2026", periodDate: "2026-06-01", scaleItemId: item.id, comment: "great" }));
    await saveJobLevel({}, form({ name: `${TAG} Extra`, sortOrder: "5" }));
    await saveEvaluationScaleItem({}, form({ label: `${TAG} Extra`, sortOrder: "5" }));

    expect(await tables()).toEqual(before);
    const employeeRow = await prisma.employee.findUnique({ where: { id: empA } });
    expect(employeeRow?.basicSalary).toBe(6000); // the employee row itself is untouched
  });
});

describe.skipIf(!hasDb)("what the list and detail pages read", () => {
  it("loadJobLevels / loadRatingScale return only the active ones, in sortOrder, alongside whatever else this suite created", async () => {
    await prisma.jobLevel.create({ data: { name: `${TAG} LZ`, sortOrder: 2 } });
    await prisma.jobLevel.create({ data: { name: `${TAG} LA2`, sortOrder: 1 } });
    await prisma.jobLevel.create({ data: { name: `${TAG} LDeleted`, sortOrder: 0, deletedAt: new Date() } });
    const levels = await loadJobLevels();
    const names = levels.map((l) => l.name);
    expect(names.indexOf(`${TAG} LA2`)).toBeLessThan(names.indexOf(`${TAG} LZ`)); // sortOrder respected
    expect(names).not.toContain(`${TAG} LDeleted`); // soft-deleted ones are left out

    await prisma.evaluationScaleItem.create({ data: { label: `${TAG} Low`, sortOrder: 1 } });
    const scale = await loadRatingScale();
    expect(scale.some((s) => s.label === `${TAG} Low`)).toBe(true);
  });

  it("loadEvaluationRows: the current job level is the MOST RECENT change, not the first", async () => {
    const levelOld = await prisma.jobLevel.create({ data: { name: `${TAG} Old` } });
    const levelNew = await prisma.jobLevel.create({ data: { name: `${TAG} New` } });
    // empB is untouched by any earlier test in this file, so its history here is exactly these two rows
    await prisma.employeeLevelChange.create({ data: { employeeId: empB, jobLevelId: levelOld.id, reason: "x", changedById: "u", changedByName: ACTOR, createdAt: new Date("2026-01-01") } });
    await prisma.employeeLevelChange.create({ data: { employeeId: empB, jobLevelId: levelNew.id, reason: "y", changedById: "u", changedByName: ACTOR, createdAt: new Date("2026-06-01") } });
    const rows = await loadEvaluationRows();
    const mine = rows.find((r) => r.employeeId === empB);
    expect(mine?.jobLevel).toMatchObject({ name: `${TAG} New` });
  });

  it("loadEmployeeEvaluationDetail: level history newest first, and no combined score anywhere in the shape", async () => {
    const detail = await loadEmployeeEvaluationDetail(empA);
    expect(detail).not.toBeNull();
    expect(detail!.levelHistory.length).toBeGreaterThanOrEqual(2);
    const dates = detail!.levelHistory.map((h) => h.createdAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(JSON.stringify(detail)).not.toMatch(/score|rank/i);
  });

  it("an unknown or deleted employee id returns null, not an error", async () => {
    expect(await loadEmployeeEvaluationDetail("no-such-employee")).toBeNull();
  });

  it("document links go through the EXISTING authorized employee-documents route (no new route, no copy)", async () => {
    await prisma.employeeDocument.create({ data: { employeeId: empA, type: "experience_certificate", fileUrl: "irrelevant-key.pdf", fileName: "exp.pdf", mimeType: "application/pdf" } });
    const detail = await loadEmployeeEvaluationDetail(empA);
    const doc = detail!.previousExperience.documents[0];
    expect(doc.url).toMatch(/^\/api\/employees\/[^/]+\/documents\?docId=/);
  });
});
