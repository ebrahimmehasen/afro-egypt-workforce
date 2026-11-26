import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";

/**
 * Missions, end to end against the sample-seeded TEST database (skipped anywhere else — tests never touch the
 * production database, see tests/setup/db-guard.ts): a date-range mission and a timed one, overtime past working
 * hours posted through the existing auto-overtime path (Settings values, systemKey, autoApprove), the no-return-punch
 * fallbacks (confirmedEnd / durationMinutes), a late return corrected by HR the next day, the legacy "mission" leave
 * type left untouched, the closed-period guard, and a mid-day exit inside the mission window not charged.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { createMission, updateMission, deleteMission } = await import("@/lib/actions/missions");
const { createLeave } = await import("@/lib/actions/leaves");
const { recalculateDailyAttendance } = await import("@/lib/attendance-service");
const { runAttendanceEffects } = await import("@/lib/attendance-effects");
const { loadPayContext, scheduleFor } = await import("@/lib/pay-context");
const { payPeriodOf } = await import("@/lib/pay-rules");
const { at } = await import("@/lib/pay-engine");

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}

const EMP = "ZZ-MIS-001";
const ACTOR = "ZZ-missions-test-admin";
const admin = (): User => ({ id: "U-mis-admin", name: ACTOR, email: "a@x", role: "admin", permissions: [] });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** A recent Monday–Wednesday some days back — far enough that postAttendanceDeductions' "finished days" window covers it. */
function workdayBack(from: number, to: number) {
  for (let back = from; back <= to; back++) {
    const d = new Date(Date.now() - back * 24 * 3_600_000);
    const day = isoDay(d);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 3) return day;
  }
  throw new Error("no working day in range");
}

let start = "09:00";
let end = "17:00";

const dayDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
const punch = (date: string, hhmm: string) => prisma.attendanceLog.create({ data: { employeeId: EMP, timestamp: at(date, hhmm), punchType: "in", source: "biometric" } });

async function cleanUp() {
  await prisma.mission.deleteMany({ where: { employeeId: EMP } });
  await prisma.leave.deleteMany({ where: { employeeId: EMP } });
  await prisma.deduction.deleteMany({ where: { employeeId: EMP } });
  await prisma.overtime.deleteMany({ where: { employeeId: EMP } });
  await prisma.attendanceLog.deleteMany({ where: { employeeId: EMP } });
  await prisma.dailyAttendance.deleteMany({ where: { employeeId: EMP } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  await prisma.payrollPeriod.deleteMany({ where: { label: { startsWith: "ZZ-mis-" } } });
  await prisma.employee.deleteMany({ where: { id: EMP } });
}

const file = (fields: Record<string, string>) => {
  const f = new FormData();
  f.set("reason", "");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return createMission({}, f);
};
const refresh = async (date: string) => {
  await recalculateDailyAttendance(EMP, date);
  await runAttendanceEffects();
};
const dailyOf = (date: string) => prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: EMP, date: dayDate(date) } } });
const deductionsOf = (date: string) => prisma.deduction.findMany({ where: { employeeId: EMP, date: dayDate(date), voidedAt: null } });
const overtimeOf = (date: string) => prisma.overtime.findMany({ where: { employeeId: EMP, date: dayDate(date), voidedAt: null } });

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("missions, on real rows", () => {
  beforeAll(async () => {
    await cleanUp();
    session = admin();
    const seed = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } });
    await prisma.employee.create({
      data: {
        id: EMP, employeeNumber: "ZZMIS-001", name: "اختبار المهمات", departmentId: seed.departmentId, jobTitle: "x",
        hireDate: new Date("2020-01-01"), shiftId: seed.shiftId, basicSalary: 6000,
        customWorkStart: "09:00", customWorkEnd: "17:00",
      },
    });
    const ctx = await loadPayContext();
    const schedule = scheduleFor(ctx, await prisma.employee.findUniqueOrThrow({ where: { id: EMP } }));
    start = schedule.start;
    end = schedule.end;
  });

  afterEach(async () => {
    await prisma.mission.deleteMany({ where: { employeeId: EMP } });
    await prisma.leave.deleteMany({ where: { employeeId: EMP } });
    await prisma.deduction.deleteMany({ where: { employeeId: EMP } });
    await prisma.overtime.deleteMany({ where: { employeeId: EMP } });
    await prisma.attendanceLog.deleteMany({ where: { employeeId: EMP } });
    await prisma.dailyAttendance.deleteMany({ where: { employeeId: EMP } });
  });

  it("a date-range mission: no punches, no deduction, attendance shows mission", async () => {
    const day = workdayBack(20, 30);
    expect(await file({ employeeId: EMP, destination: "فرع الإسكندرية", from: day, to: day })).toHaveProperty("success", true);
    await refresh(day);
    expect((await dailyOf(day))?.status).toBe("mission");
    expect(await deductionsOf(day)).toEqual([]);
  });

  it("a timed mission inside working hours: the time counts as worked, no deduction", async () => {
    const day = workdayBack(20, 30);
    await punch(day, start);
    await punch(day, end);
    expect(await file({ employeeId: EMP, destination: "عميل", from: day, to: day, startTime: "11:00", endTime: "13:00" })).toHaveProperty("success", true);
    await refresh(day);
    const daily = await dailyOf(day);
    expect(daily?.status).toBe("mission");
    expect(daily?.deductibleLateMinutes).toBe(0);
    expect(daily?.earlyLeaveMinutes).toBe(0);
    expect(await deductionsOf(day)).toEqual([]);
  });

  it("a mid-day exit that falls inside the mission window is not charged as an unauthorized exit", async () => {
    const day = workdayBack(20, 30);
    // out for the mission, back after it — exactly the pattern mid-day-exits.ts would otherwise flag
    await punch(day, start);
    await punch(day, "11:00");
    await punch(day, "13:00");
    await punch(day, end);
    await file({ employeeId: EMP, destination: "عميل", from: day, to: day, startTime: "11:00", endTime: "13:00" });
    await refresh(day);
    expect((await deductionsOf(day)).map((d) => d.type)).not.toContain("unauthorized_exit");
  });

  it("a mission past the overtime start, with a return punch: overtime is posted from Settings values via the normal auto-overtime path", async () => {
    const day = workdayBack(20, 30);
    await punch(day, start);
    // 90 minutes past the work end — a full step at the fallback pay type's 30-minute step, well over its 60-minute minimum
    await punch(day, "18:30");
    await file({ employeeId: EMP, destination: "عميل", from: day, to: day, startTime: "16:00", endTime: "18:30" });
    await refresh(day);
    const [ot] = await overtimeOf(day);
    expect(ot).toBeTruthy();
    expect(ot.autoGenerated).toBe(true);
    expect(ot.systemKey).toBe(`${EMP}|${day}|overtime`);
    expect(ot.multiplier).toBe(1.5); // FALLBACK_PAY_TYPES.monthly.overtimeMultiplier
    expect(ot.hours).toBeCloseTo(1.5, 5); // 90 counted minutes (step 30, minimum 60) = 1.5h
    expect(ot.status).toBe("approved"); // FALLBACK_PAY_TYPES.monthly.overtimeAutoApprove
  });

  it("no return punch, with a confirmed end time: overtime is computed from it", async () => {
    const day = workdayBack(20, 30);
    await punch(day, start); // only a check-in that day — the mission swallowed the check-out
    await file({ employeeId: EMP, destination: "عميل", from: day, to: day, startTime: "16:00", confirmedEnd: "18:30" });
    await refresh(day);
    expect((await dailyOf(day))?.status).toBe("mission");
    const [ot] = await overtimeOf(day);
    expect(ot?.hours).toBeCloseTo(1.5, 5);
  });

  it("no return punch, with a duration instead: overtime is computed from start + duration", async () => {
    const day = workdayBack(20, 30);
    await punch(day, start);
    await file({ employeeId: EMP, destination: "عميل", from: day, to: day, startTime: "16:00", durationMinutes: "150" }); // 16:00 + 150m = 18:30
    await refresh(day);
    const [ot] = await overtimeOf(day);
    expect(ot?.hours).toBeCloseTo(1.5, 5);
  });

  it("a late return HR corrects the next day: the recompute uses the corrected punch, not the fallback", async () => {
    const day = workdayBack(20, 30);
    await punch(day, start);
    await file({ employeeId: EMP, destination: "عميل", from: day, to: day, startTime: "16:00", durationMinutes: "150" }); // fallback: 18:30
    await refresh(day);
    expect((await overtimeOf(day))[0]?.hours).toBeCloseTo(1.5, 5);

    // HR corrects the check-out to the real, later return (19:30) — a manual DailyAttendance correction, same as
    // the existing correction flow: it must win over the fallback on the next recompute.
    await prisma.dailyAttendance.update({
      where: { employeeId_date: { employeeId: EMP, date: dayDate(day) } },
      data: { actualOut: at(day, "19:30"), correctionReason: "HR corrected the return punch", correctedBy: ACTOR, correctedAt: new Date() },
    });
    await runAttendanceEffects();
    const [ot] = await overtimeOf(day);
    expect(ot.hours).toBeCloseTo(2.5, 5); // 150 counted minutes past the 17:00 end
  });

  it("the legacy 'mission' leave type still works exactly as before: full day, zero deduction", async () => {
    const day = workdayBack(20, 30);
    expect(await createLeave({}, (() => { const f = new FormData(); f.set("employeeId", EMP); f.set("type", "mission"); f.set("from", day); f.set("to", day); f.set("reason", ""); return f; })())).toHaveProperty("success", true);
    const leave = await prisma.leave.findFirstOrThrow({ where: { employeeId: EMP, type: "mission" } });
    await prisma.leave.update({ where: { id: leave.id }, data: { status: "approved", approvedBy: ACTOR } });
    await refresh(day);
    const daily = await dailyOf(day);
    expect(daily?.status).toBe("mission");
    expect(daily?.deductibleLateMinutes).toBe(0);
    expect(await deductionsOf(day)).toEqual([]);
  });

  it("refuses to create a mission in a closed pay period", async () => {
    const day = workdayBack(40, 90);
    const { year, month } = payPeriodOf(day, (await loadPayContext()).payPeriodStartDay);
    const period = await prisma.payrollPeriod.create({ data: { label: "ZZ-mis-closed", year, month, status: "closed", calculatedAt: new Date(), approvedAt: new Date(), closedAt: new Date() } });
    const result = await file({ employeeId: EMP, destination: "عميل", from: day, to: day });
    expect(result).toHaveProperty("error");
    expect(await prisma.mission.findFirst({ where: { employeeId: EMP, from: dayDate(day) } })).toBeNull();
    await prisma.payrollPeriod.delete({ where: { id: period.id } });
  });

  it("creates approved immediately, can be updated and deleted", async () => {
    const day = workdayBack(20, 30);
    const created = await file({ employeeId: EMP, destination: "فرع طنطا", from: day, to: day });
    expect(created).toHaveProperty("success", true);
    const mission = await prisma.mission.findFirstOrThrow({ where: { employeeId: EMP, from: dayDate(day) } });
    expect(mission.status).toBe("approved");
    expect(mission.approvedBy).toBe(ACTOR);

    const updateForm = new FormData();
    updateForm.set("id", mission.id);
    updateForm.set("employeeId", EMP);
    updateForm.set("destination", "فرع المنصورة");
    updateForm.set("from", day);
    updateForm.set("to", day);
    updateForm.set("reason", "");
    expect(await updateMission({}, updateForm)).toHaveProperty("success", true);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).destination).toBe("فرع المنصورة");

    expect(await deleteMission(mission.id)).toHaveProperty("success", true);
    expect(await prisma.mission.findUnique({ where: { id: mission.id } })).toBeNull();
  });
});
