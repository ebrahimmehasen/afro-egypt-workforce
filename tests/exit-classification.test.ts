import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";

/**
 * The exit classification, end to end, against the sample-seeded TEST database (skipped anywhere else; the tests never
 * use the production database — tests/setup/db-guard.ts): the permission duration modes, classifying a detected
 * exit with a permission, the record-only note for a mission / excused absence, who may do either, and — checked on
 * the rows themselves — that a day inside an approved pay month is refused and its Daily / Overtime / Deduction rows
 * come out byte-identical, even after the whole effects pipeline has run.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { createLeave } = await import("@/lib/actions/leaves");
const { classifyExit } = await import("@/lib/actions/leaves");
const { annotateExit } = await import("@/lib/actions/exit-annotations");
const { runAttendanceEffects } = await import("@/lib/attendance-effects");
const { recalculateDailyAttendance } = await import("@/lib/attendance-service");
const { loadPayContext, scheduleFor } = await import("@/lib/pay-context");
const { at } = await import("@/lib/pay-engine");
const { payPeriodOf, payPeriodRange } = await import("@/lib/pay-rules");
const { exitWindow } = await import("@/lib/permission-duration");
const { latestAnnotations, parseAnnotationKey } = await import("@/lib/exit-annotation");
const { systemKey } = await import("@/lib/attendance-deductions");
const { canApprove } = await import("@/lib/permissions");

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}

const EMP = "ZZ-CLS-001";
const ACTOR = "ZZ-cls-test-admin";
const admin = (): User => ({ id: "U-cls-admin", name: ACTOR, email: "a@x", role: "admin", permissions: [] });
const FORM_DAY = "2030-03-12"; // a Tuesday far from every other day, for the form's duration modes
const dayDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

let start = "08:00";
let end = "16:00";
let startDay = 26;
const days = { classify: "", note: "", locked: "" };

/** A recent Monday to Wednesday that many days back, so it is a working day and never the weekly day off. */
function workdayBack(from: number, to: number, not: string[] = []) {
  for (let back = from; back <= to; back++) {
    const d = new Date(Date.now() - back * 24 * 3_600_000);
    const day = isoDay(d);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 3 && !not.includes(day)) return day;
  }
  throw new Error("no working day in range");
}

async function cleanUp() {
  await prisma.leave.deleteMany({ where: { employeeId: EMP } });
  await prisma.deduction.deleteMany({ where: { employeeId: EMP } });
  await prisma.overtime.deleteMany({ where: { employeeId: EMP } });
  await prisma.attendanceLog.deleteMany({ where: { employeeId: EMP } });
  await prisma.dailyAttendance.deleteMany({ where: { employeeId: EMP } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ userName: ACTOR }, { oldValue: { startsWith: `exit-annotation:v1|${EMP}|` } }] } });
  await prisma.payrollPeriod.deleteMany({ where: { label: "ZZ-cls-locked" } });
  await prisma.employee.deleteMany({ where: { id: EMP } });
}

/** One working day with a real exit in the middle: in a bit before the start, out 3h in for an hour, last punch after the end. */
async function seedDayWithExit(date: string) {
  const out = at(date, hhmm(minutes(start) + 180));
  const back = new Date(out.getTime() + 3_600_000);
  const punches: [Date, "in" | "out"][] = [[new Date(at(date, start).getTime() - 5 * 60_000), "in"], [out, "out"], [back, "out"], [new Date(at(date, end, start).getTime() + 5 * 60_000), "out"]];
  for (const [timestamp, punchType] of punches) await prisma.attendanceLog.create({ data: { employeeId: EMP, timestamp, punchType, source: "biometric" } });
  await recalculateDailyAttendance(EMP, date);
  await runAttendanceEffects();
  return { out, back };
}

const rowsOf = (from: string, to: string) =>
  Promise.all([
    prisma.dailyAttendance.findMany({ where: { date: { gte: dayDate(from), lte: dayDate(to) } }, orderBy: [{ employeeId: "asc" }, { date: "asc" }] }),
    prisma.overtime.findMany({ where: { date: { gte: dayDate(from), lte: dayDate(to) } }, orderBy: { id: "asc" } }),
    prisma.deduction.findMany({ where: { date: { gte: dayDate(from), lte: dayDate(to) } }, orderBy: { id: "asc" } }),
  ]);
/** Every field of every row, as text: equal text is byte-identical rows. */
const snapshot = async (from: string, to: string) => {
  const [daily, overtime, deductions] = await rowsOf(from, to);
  return { counts: [daily.length, overtime.length, deductions.length], text: JSON.stringify({ daily, overtime, deductions }) };
};
const deductionTypes = async (date: string) =>
  (await prisma.deduction.findMany({ where: { employeeId: EMP, date: dayDate(date), voidedAt: null } })).map((d) => d.type).sort();

const formFile = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const filePermission = (extra: Record<string, string>) =>
  createLeave({}, formFile({ employeeId: EMP, type: "permission", from: FORM_DAY, to: FORM_DAY, reason: "", ...extra }));
const savedForm = () => prisma.leave.findMany({ where: { employeeId: EMP, from: dayDate(FORM_DAY) }, orderBy: { createdAt: "asc" } });

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("the exit classification, on real rows", () => {
  beforeAll(async () => {
    await cleanUp();
    session = admin();
    const ctx = await loadPayContext();
    startDay = ctx.payPeriodStartDay;
    const seed = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } });
    await prisma.employee.create({
      data: { id: EMP, employeeNumber: "ZZCLS-001", name: "اختبار تصنيف الخروج", departmentId: seed.departmentId, jobTitle: "x", hireDate: new Date("2024-01-01"), shiftId: seed.shiftId, basicSalary: 6000 },
    });
    const schedule = scheduleFor(ctx, await prisma.employee.findUniqueOrThrow({ where: { id: EMP } }));
    start = schedule.start;
    end = schedule.end;
    days.classify = workdayBack(3, 12);
    days.note = workdayBack(3, 12, [days.classify]);
    // the locked day: 40 to 70 days back, in a pay month other than the two days above (and with no period yet)
    const monthOf = (d: string) => payPeriodOf(d, startDay);
    const open = new Set([monthOf(days.classify), monthOf(days.note)].map((m) => `${m.year}-${m.month}`));
    for (let back = 40; back <= 70; back++) {
      const d = new Date(Date.now() - back * 24 * 3_600_000);
      const day = isoDay(d);
      const m = monthOf(day);
      const taken = await prisma.payrollPeriod.findUnique({ where: { year_month: { year: m.year, month: m.month } } });
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 3 && !open.has(`${m.year}-${m.month}`) && !taken) {
        days.locked = day;
        break;
      }
    }
    expect(days.locked).not.toBe("");
  });

  // ------------------------------------------------------------------------------- Feature 1: the form's durations
  describe("filing a permission: preset, minutes, or until a time", () => {
    const leaveAt = () => hhmm(minutes(start) + 120);
    const clear = () => prisma.leave.deleteMany({ where: { employeeId: EMP, from: dayDate(FORM_DAY) } });

    it("a quick choice and a custom number of minutes are stored as minutes", async () => {
      await clear();
      expect(await filePermission({ startTime: leaveAt(), durationMinutes: "60" })).toMatchObject({ success: true });
      await clear();
      expect(await filePermission({ startTime: leaveAt(), durationMinutes: "45" })).toMatchObject({ success: true });
      const [row] = await savedForm();
      expect(row).toMatchObject({ type: "permission", startTime: leaveAt(), durationMinutes: 45, status: "pending" });
    });

    it("until a time becomes the minutes from the start, and stores no time of its own", async () => {
      await clear();
      const until = hhmm(minutes(start) + 120 + 90);
      expect(await filePermission({ startTime: leaveAt(), untilTime: until })).toMatchObject({ success: true });
      const [row] = await savedForm();
      expect(row.durationMinutes).toBe(90);
      expect(row.startTime).toBe(leaveAt());
    });

    it("an until time that is not later than the start is refused with its own message, and nothing is saved", async () => {
      await clear();
      expect(await filePermission({ startTime: leaveAt(), untilTime: leaveAt() })).toEqual({ error: ar.leaves.errUntilNotLater, fields: ["untilTime"] });
      expect(await filePermission({ startTime: leaveAt(), untilTime: hhmm(minutes(start) + 60) })).toEqual({ error: ar.leaves.errUntilNotLater, fields: ["untilTime"] });
      expect(await filePermission({ startTime: leaveAt() })).toHaveProperty("error"); // neither minutes nor a time
      expect(await savedForm()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------ Feature 2: classify with a permission
  describe("classifying a detected exit with a permission", () => {
    it("creates the approved permission for exactly that stretch, and the day is charged the way a permission is", async () => {
      const { out, back } = await seedDayWithExit(days.classify);
      // before: the stretch is an exit without permission
      expect(await deductionTypes(days.classify)).toContain("unauthorized_exit");
      const dailyBefore = await prisma.dailyAttendance.findFirstOrThrow({ where: { employeeId: EMP, date: dayDate(days.classify) } });

      const w = exitWindow(out, back);
      const result = await classifyExit(
        {},
        formFile({ employeeId: EMP, date: days.classify, kind: "permission", startTime: w.startTime, durationMinutes: String(w.minutes), reason: "" }),
      );
      expect(result).toEqual({ success: true, message: ar.midDay.classifyDone });

      // the Leave: approved, by the actor, covering exactly that window, for that one day
      const leaves = await prisma.leave.findMany({ where: { employeeId: EMP, from: dayDate(days.classify) } });
      expect(leaves).toHaveLength(1);
      expect(leaves[0]).toMatchObject({ type: "permission", status: "approved", approvedBy: ACTOR, startTime: w.startTime, durationMinutes: w.minutes });
      expect(isoDay(leaves[0].to)).toBe(days.classify);
      // the audit entry
      const audit = await prisma.auditLogEntry.findMany({ where: { userName: ACTOR, action: ar.auditActions.classifyExit } });
      expect(audit).toHaveLength(1);
      expect(audit[0].newValue).toContain("ZZCLS-001");

      // the day is worked out again and the system rows follow, through the existing machinery
      await runAttendanceEffects();
      const dailyAfter = await prisma.dailyAttendance.findFirstOrThrow({ where: { employeeId: EMP, date: dayDate(days.classify) } });
      expect(dailyAfter.updatedAt.getTime()).toBeGreaterThan(dailyBefore.updatedAt.getTime());
      const types = await deductionTypes(days.classify);
      expect(types).not.toContain("unauthorized_exit");
      expect(types).not.toContain("permission_overrun");
    });

    it("refuses a stretch outside the employee's hours, and a time that overlaps the permission already there", async () => {
      const before = await prisma.leave.count({ where: { employeeId: EMP } });
      const early = await classifyExit({}, formFile({ employeeId: EMP, date: days.classify, kind: "permission", startTime: hhmm(minutes(start) - 60), durationMinutes: "30" }));
      expect(early).toHaveProperty("error");
      const overlap = await classifyExit({}, formFile({ employeeId: EMP, date: days.classify, kind: "permission", startTime: hhmm(minutes(start) + 185), durationMinutes: "20" }));
      expect(overlap).toEqual({ error: ar.leaves.errOverlap });
      expect(await prisma.leave.count({ where: { employeeId: EMP } })).toBe(before);
    });

    it("only an account that may approve leaves can do it; a mission / excused absence never creates a Leave", async () => {
      const before = await prisma.leave.count({ where: { employeeId: EMP } });
      const form = formFile({ employeeId: EMP, date: days.note, kind: "permission", startTime: hhmm(minutes(start) + 300), durationMinutes: "30" });
      for (const user of [
        { role: "supervisor", permissions: ["leaves"] },
        { role: "staff", permissions: [] },
        { role: "hr", permissions: ["attendance"] }, // HR without the leaves permission
      ]) {
        session = { id: "U-x", name: ACTOR, email: "x@x", role: user.role, permissions: user.permissions } as User;
        expect(await classifyExit({}, form)).toEqual({ error: ar.validation.notAllowed });
      }
      session = null;
      expect(await classifyExit({}, form)).toEqual({ error: ar.validation.notAllowed });
      session = admin();
      // HR holding "leaves" is who the check lets through; a mission or excused absence is refused as a classification
      expect(canApprove({ role: "hr", permissions: ["leaves"] } as User, "leaves")).toBe(true);
      expect(canApprove({ role: "hr", permissions: ["attendance"] } as User, "leaves")).toBe(false);
      for (const kind of ["mission", "excused_absence", "annual"]) {
        expect(await classifyExit({}, formFile({ employeeId: EMP, date: days.note, kind, startTime: hhmm(minutes(start) + 300), durationMinutes: "30" }))).toEqual({ error: ar.midDay.errClassifyKind });
      }
      expect(await prisma.leave.count({ where: { employeeId: EMP } })).toBe(before);
    });
  });

  // ----------------------------------------------------------- Feature 2: a mission / excused absence, record only
  describe("recording an exit as a mission or an excused absence", () => {
    it("writes one audit entry and changes nothing in any pay row: the stretch is still charged", async () => {
      const { out, back } = await seedDayWithExit(days.note);
      expect(await deductionTypes(days.note)).toContain("unauthorized_exit");
      const lo = isoDay(new Date(dayDate(days.note).getTime() - 40 * 24 * 3_600_000));
      const before = await snapshot(lo, days.note);
      const leavesBefore = await prisma.leave.count({ where: { employeeId: EMP, from: dayDate(days.note) } });
      const auditBefore = await prisma.auditLogEntry.count();

      const key = { employeeId: EMP, date: days.note, out: out.toISOString(), back: back.toISOString() };
      expect(await annotateExit({}, formFile({ ...key, type: "mission", reason: "مأمورية لمخزن الميناء" }))).toEqual({ success: true, message: ar.midDay.annotateDone });
      expect(await annotateExit({}, formFile({ ...key, type: "excused_absence", reason: "عذر مرضي بشهادة" }))).toEqual({ success: true, message: ar.midDay.annotateDone });

      // exactly the two audit entries, no Leave, and — even after the whole pipeline — not a byte of any pay row
      expect(await prisma.auditLogEntry.count()).toBe(auditBefore + 2);
      expect(await prisma.leave.count({ where: { employeeId: EMP, from: dayDate(days.note) } })).toBe(leavesBefore);
      await runAttendanceEffects({ payrollChanged: true });
      const after = await snapshot(lo, days.note);
      expect(after.counts).toEqual(before.counts);
      expect(after.text).toBe(before.text);
      expect(await deductionTypes(days.note)).toContain("unauthorized_exit");

      // the note reads back as the latest one, with who and why
      const entries = await prisma.auditLogEntry.findMany({ where: { oldValue: { startsWith: `exit-annotation:v1|${EMP}|` } } });
      const notes = latestAnnotations(entries);
      expect(notes.get(`${EMP}|${days.note}|${out.toISOString()}`)).toMatchObject({ type: "excused_absence", by: ACTOR, reason: "عذر مرضي بشهادة" });
      expect(parseAnnotationKey(entries[0].oldValue)).toMatchObject({ employeeId: EMP, date: days.note });
    });

    it("needs a reason and a stretch that is really in the employee's punches, and the right to approve leaves", async () => {
      const { out, back } = await (async () => {
        const o = at(days.note, hhmm(minutes(start) + 180));
        return { out: o, back: new Date(o.getTime() + 3_600_000) };
      })();
      const key = { employeeId: EMP, date: days.note, type: "mission", out: out.toISOString(), back: back.toISOString() };
      const auditBefore = await prisma.auditLogEntry.count();
      expect(await annotateExit({}, formFile({ ...key, reason: "  " }))).toEqual({ error: ar.midDay.errAnnotateReason });
      expect(await annotateExit({}, formFile({ ...key, reason: "ok no", out: new Date(out.getTime() + 60_000).toISOString() }))).toEqual({ error: ar.midDay.errAnnotateStretch });
      expect(await annotateExit({}, formFile({ ...key, reason: "سبب", type: "annual" }))).toEqual({ error: ar.validation.invalidData });
      session = { id: "U-x", name: ACTOR, email: "x@x", role: "supervisor", permissions: ["leaves"] } as User;
      expect(await annotateExit({}, formFile({ ...key, reason: "سبب كافي" }))).toEqual({ error: ar.validation.notAllowed });
      session = admin();
      expect(await prisma.auditLogEntry.count()).toBe(auditBefore);
    });
  });

  // ------------------------------------------------------------------------------------- the locked-period guard
  describe("a day inside an approved pay month", () => {
    it("is refused by every entry point, and every Daily / Overtime / Deduction row of the month stays byte-identical through the whole pipeline", async () => {
      const date = days.locked;
      const m = payPeriodOf(date, startDay);
      const range = payPeriodRange(m.year, m.month, startDay);
      // the day as it stood: punches with an exit, the day's row, and system rows the job WOULD change if it touched the day
      const { out, back } = await seedDayWithExit(date); // (also posts its deductions while the month is still open)
      const w = exitWindow(out, back);
      await prisma.deduction.updateMany({ where: { employeeId: EMP, date: dayDate(date) }, data: { amount: 999, originalAmount: 999 } });
      await prisma.overtime.create({
        data: { employeeId: EMP, date: dayDate(date), hours: 2, hourlyRate: 100, amount: 200, status: "approved", kind: "overtime", multiplier: 1.5, autoGenerated: true, systemKey: systemKey(EMP, date, "overtime"), notes: "zz" },
      });
      const period = await prisma.payrollPeriod.create({ data: { label: "ZZ-cls-locked", year: m.year, month: m.month, status: "approved", approvedAt: new Date(), calculatedAt: new Date() } });

      const before = await snapshot(range.from, range.to);
      expect(before.counts.every((n) => n >= 1)).toBe(true); // the month has rows of every kind to protect
      const leavesBefore = await prisma.leave.count({ where: { employeeId: EMP } });
      const auditBefore = await prisma.auditLogEntry.count();

      // 1. classifying with a permission
      expect(await classifyExit({}, formFile({ employeeId: EMP, date, kind: "permission", startTime: w.startTime, durationMinutes: String(w.minutes) }))).toEqual({ error: ar.leaves.errLockedPeriod });
      // 2. the record-only note
      expect(await annotateExit({}, formFile({ employeeId: EMP, date, type: "mission", out: out.toISOString(), back: back.toISOString(), reason: "مأمورية" }))).toEqual({ error: ar.leaves.errLockedPeriod });
      // 3. filing a permission through the leave form (a correction entry point this work changed)
      const filed = await createLeave({}, formFile({ employeeId: EMP, type: "permission", from: date, to: date, startTime: w.startTime, untilTime: hhmm(minutes(w.startTime) + w.minutes) }));
      expect(filed).toEqual({ error: ar.leaves.errLockedPeriod });

      // nothing was written, and the effects pipeline those flows trigger leaves the month untouched too
      expect(await prisma.leave.count({ where: { employeeId: EMP } })).toBe(leavesBefore);
      expect(await prisma.auditLogEntry.count()).toBe(auditBefore);
      await runAttendanceEffects({ payrollChanged: true });
      const after = await snapshot(range.from, range.to);
      expect(after.counts).toEqual(before.counts);
      expect(after.text).toBe(before.text);

      // and a successful classification on an open day, with its effects, still leaves the locked month byte-identical
      const open = await prisma.leave.findFirst({ where: { employeeId: EMP, from: dayDate(days.classify) } });
      expect(open).not.toBeNull(); // (classified earlier in this file)
      await runAttendanceEffects({ payrollChanged: true });
      const final = await snapshot(range.from, range.to);
      expect(final.text).toBe(before.text);

      // the period itself and its records: not edited, none created
      const stored = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } });
      expect(stored.status).toBe("approved");
      expect(stored.approvedAt?.getTime()).toBe(period.approvedAt?.getTime());
      expect(await prisma.payrollRecord.count({ where: { periodId: period.id } })).toBe(0);
    });
  });
});
