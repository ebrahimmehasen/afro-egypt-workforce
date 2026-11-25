import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { format } from "@/lib/i18n/format";

/**
 * The payroll approval guard and the reviewed punches, against the sample-seeded TEST database (skipped anywhere else:
 * the tests never use the production database, see tests/setup/db-guard.ts). The days are in 2019, far from any seeded
 * data. Real applyApprovePayrollPeriod and applyAddReviewedPunches: the guard blocks while a day still needs review and
 * allows once its punches are complete; the guard and the list create no punch; a period of clear days approves as before.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
// the posting job runs after a real write; here nothing is posted, the punches themselves are what is under test
vi.mock("@/lib/attendance-effects", () => ({ scheduleAttendanceEffects: () => {} }));

const { applyApprovePayrollPeriod } = await import("@/lib/actions/payroll");
const { addReviewedPunches, applyAddReviewedPunches } = await import("@/lib/actions/review-punches");
const { loadReviewDays, loadReviewForViewer } = await import("@/lib/missing-punch-review");
const { loadPayContext, kindOf } = await import("@/lib/pay-context");
const { payPeriodRange } = await import("@/lib/pay-rules");

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}

const EMP = "ZZ-GRD-001";
const ACTOR = "ZZ-guard-test";
const YEAR = 2019;
const MONTHS = { odd: 6, corrected: 7, locked: 8, clear: 9, status: 10 };
const admin = (): User => ({ id: "U-grd", name: ACTOR, email: "a@x", role: "admin", permissions: [] });

let employeeShiftId = "";
let departmentId = "";

/** The first working day of the pay month (not the weekly day off or a holiday). */
async function workingDay(month: number, nth = 0) {
  const ctx = await loadPayContext();
  const { from, to } = payPeriodRange(YEAR, month, ctx.payPeriodStartDay);
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const day = d.toISOString().slice(0, 10);
    if (kindOf(ctx, day) === "workday") days.push(day);
  }
  return days[nth + 5]; // a day well inside the month
}

const at = (day: string, time: string) => new Date(`${day}T${time}:00`);
async function makeDay(day: string, opts: { status?: "present" | "missing_punch"; corrected?: boolean; punches: string[]; outTime?: string | null }) {
  const outTime = opts.outTime === undefined ? "20:00" : opts.outTime;
  for (const t of opts.punches) {
    await prisma.attendanceLog.create({ data: { employeeId: EMP, timestamp: at(day, t), punchType: t === "08:00" ? "in" : "out", source: "biometric" } });
  }
  await prisma.dailyAttendance.create({
    data: {
      employeeId: EMP,
      date: new Date(`${day}T00:00:00.000Z`),
      shiftId: employeeShiftId,
      scheduledStart: at(day, "08:00"),
      scheduledEnd: at(day, "16:30"),
      actualIn: at(day, "08:00"),
      actualOut: outTime ? at(day, outTime) : null,
      status: opts.status ?? "present",
      correctionReason: opts.corrected ? "HR set the check-out" : null,
      correctedBy: opts.corrected ? ACTOR : null,
    },
  });
}
const period = (month: number, status: "calculated" | "approved") =>
  prisma.payrollPeriod.create({ data: { label: `guard-test-${month}`, year: YEAR, month, status, calculatedAt: new Date(), approvedAt: status === "approved" ? new Date() : null } });
const approve = (id: string) => applyApprovePayrollPeriod({ periodId: id }, ACTOR);
const status = async (id: string) => (await prisma.payrollPeriod.findUniqueOrThrow({ where: { id } })).status;
const logs = () => prisma.attendanceLog.findMany({ where: { employeeId: EMP }, orderBy: { timestamp: "asc" } });

async function cleanup() {
  await prisma.leave.deleteMany({ where: { employeeId: EMP } });
  await prisma.attendanceLog.deleteMany({ where: { employeeId: EMP } });
  await prisma.dailyAttendance.deleteMany({ where: { employeeId: EMP } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  await prisma.payrollPeriod.deleteMany({ where: { year: YEAR, label: { startsWith: "guard-test-" } } });
}

beforeAll(async () => {
  if (!sampleDb) return;
  await cleanup();
  await prisma.employee.deleteMany({ where: { id: EMP } });
  session = admin();
  const seed = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } });
  employeeShiftId = seed.shiftId;
  departmentId = seed.departmentId;
  await prisma.employee.create({
    data: { id: EMP, employeeNumber: "ZZGRD-001", name: "اختبار حارس الاعتماد", departmentId, jobTitle: "x", hireDate: new Date("2018-01-01"), shiftId: employeeShiftId, basicSalary: 6000 },
  });
});

afterAll(async () => {
  if (sampleDb) {
    await cleanup();
    await prisma.employee.deleteMany({ where: { id: EMP } });
  }
  await prisma.$disconnect();
});

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe.skipIf(!sampleDb)("approving a pay period with a day that still needs review", () => {
  it("is refused while an odd number of punches is on the day, says how many and where to resolve them, and creates no punch", async () => {
    const day = await workingDay(MONTHS.odd);
    await makeDay(day, { punches: ["08:00", "12:00", "20:00"] }); // an exit with no return
    const p = await period(MONTHS.odd, "calculated");
    const before = await logs();

    const refused = await approve(p.id);
    expect(refused).toEqual({ error: format(ar.reviewPunch.approveBlocked, { count: 1 }) });
    expect(refused.error).toMatch(/1/);
    expect(await status(p.id)).toBe("calculated");

    // the list and the guard only read: not a punch is created
    const ctx = await loadPayContext();
    const { from, to } = payPeriodRange(YEAR, MONTHS.odd, ctx.payPeriodStartDay);
    expect((await loadReviewDays({ scope: { all: true }, from, to })).map((d) => d.reason)).toEqual(["odd_punches"]);
    expect((await loadReviewForViewer(admin(), from, to)).map((d) => d.date)).toEqual([day]);
    expect(await logs()).toEqual(before);
  });

  it("allows it once HR's reviewed return completes the pair, and the device's own punches are untouched", async () => {
    const day = await workingDay(MONTHS.odd);
    const p = await prisma.payrollPeriod.findFirstOrThrow({ where: { year: YEAR, month: MONTHS.odd } });
    const before = await logs();

    const saved = await applyAddReviewedPunches({ employeeId: EMP, date: day, backTime: "13:00", reason: "the manager confirmed the return" }, ACTOR);
    expect(saved).toHaveProperty("success", true);

    const after = await logs();
    expect(after).toHaveLength(before.length + 1);
    for (const row of before) expect(after.find((r) => r.id === row.id)).toEqual(row); // nothing existing changed
    const added = after.find((r) => !before.some((b) => b.id === r.id))!;
    expect(added).toMatchObject({ punchType: "in", source: "manual_correction" });
    expect(added.timestamp.getTime()).toBe(at(day, "13:00").getTime());
    expect(added.rawPayload).toMatchObject({ hrReview: { by: ACTOR, reason: "the manager confirmed the return", role: "back" } });
    // one audit entry says who and why
    expect(await prisma.auditLogEntry.count({ where: { userName: ACTOR, reason: "the manager confirmed the return" } })).toBe(1);

    expect(await approve(p.id)).toEqual({ success: true });
    expect(await status(p.id)).toBe("approved");
  });

  it("a corrected day with an approved temporary permission blocks until a reviewed stretch exists", async () => {
    const day = await workingDay(MONTHS.corrected);
    await makeDay(day, { corrected: true, punches: ["08:00", "11:00", "11:40", "20:00"] }); // device exit and return: ignored on a corrected day
    await prisma.leave.create({ data: { employeeId: EMP, type: "permission", from: new Date(`${day}T00:00:00.000Z`), to: new Date(`${day}T00:00:00.000Z`), reason: "x", startTime: "12:00", durationMinutes: 60, status: "approved", approvedBy: ACTOR } });
    const p = await period(MONTHS.corrected, "calculated");

    expect(await approve(p.id)).toEqual({ error: format(ar.reviewPunch.approveBlocked, { count: 1 }) });
    expect(await status(p.id)).toBe("calculated");

    expect(await applyAddReviewedPunches({ employeeId: EMP, date: day, outTime: "12:10", backTime: "12:50", reason: "confirmed by the manager" }, ACTOR)).toHaveProperty("success", true);
    expect(await approve(p.id)).toEqual({ success: true });
  });

  it("a period whose days are all clear approves as before", async () => {
    const day = await workingDay(MONTHS.clear);
    await makeDay(day, { punches: ["08:00", "20:00"] });
    const p = await period(MONTHS.clear, "calculated");
    expect(await approve(p.id)).toEqual({ success: true });
    expect(await status(p.id)).toBe("approved");
  });

  it("a day with a missing check-out blocks the period too, and the guard's message is the same", async () => {
    const day = await workingDay(MONTHS.status);
    await makeDay(day, { status: "missing_punch", punches: ["08:00"], outTime: null });
    const p = await period(MONTHS.status, "calculated");
    expect(await approve(p.id)).toEqual({ error: format(ar.reviewPunch.approveBlocked, { count: 1 }) });
    expect(await status(p.id)).toBe("calculated");
  });
});

describe.skipIf(!sampleDb)("entering reviewed punches", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    f.set("employeeId", EMP);
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return addReviewedPunches({}, f);
  };

  it("is refused for a day in an approved period, and nothing is written", async () => {
    const day = await workingDay(MONTHS.locked);
    await makeDay(day, { punches: ["08:00", "12:00", "20:00"] });
    await period(MONTHS.locked, "approved");
    const before = await logs();
    expect(await applyAddReviewedPunches({ employeeId: EMP, date: day, backTime: "13:00", reason: "confirmed" }, ACTOR)).toEqual({ error: ar.leaves.errLockedPeriod });
    expect(await logs()).toEqual(before);
  });

  it("is refused for HR outside the employee's departments, and for HR without the attendance right", async () => {
    const day = await workingDay(MONTHS.status);
    const before = await logs();
    session = { id: "U-hr", name: "hr", email: "h@x", role: "hr", permissions: ["attendance"], departmentIds: ["NOT-THIS-DEPARTMENT"] };
    expect(await form({ date: day, backTime: "13:00", reason: "confirmed" })).toEqual({ error: ar.validation.notAllowed });
    session = { id: "U-hr2", name: "hr2", email: "h@x", role: "hr", permissions: ["leaves"], departmentIds: [] };
    expect(await form({ date: day, backTime: "13:00", reason: "confirmed" })).toEqual({ error: ar.validation.notAllowed });
    session = { id: "U-emp", name: "emp", email: "e@x", role: "employee", permissions: [], employeeId: EMP };
    expect(await form({ date: day, backTime: "13:00", reason: "confirmed" })).toEqual({ error: ar.validation.notAllowed });
    session = admin();
    expect(await logs()).toEqual(before);
  });

  it("refuses a time outside the day and a missing reason, without writing", async () => {
    const day = await workingDay(MONTHS.status);
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: EMP, date: new Date(`${day}T00:00:00.000Z`) } }, data: { actualOut: at(day, "20:00") } });
    const before = await logs();
    expect(await applyAddReviewedPunches({ employeeId: EMP, date: day, outTime: "21:00", reason: "confirmed" }, ACTOR)).toEqual({ error: ar.reviewPunch.errOutsideDay });
    expect(await applyAddReviewedPunches({ employeeId: EMP, date: day, outTime: "12:00", reason: "" }, ACTOR)).toEqual({ error: ar.reviewPunch.errReason });
    expect(await applyAddReviewedPunches({ employeeId: EMP, date: day, reason: "confirmed" }, ACTOR)).toEqual({ error: ar.reviewPunch.errNeedOne });
    expect(await logs()).toEqual(before);
  });
});
