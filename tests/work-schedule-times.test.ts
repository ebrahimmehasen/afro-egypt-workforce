import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PayContext, PayEmployee, effectiveShift, scheduleFor } from "@/lib/pay-context";
import { PayTypeRules } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { systemEntriesFor } from "@/lib/attendance-deductions";
import { computeDailyAttendance, getShiftWindow, shiftDaysForPunch } from "@/lib/attendance-engine";
import type { User } from "@/lib/types";

/**
 * Working hours ("مواعيد العمل" — WorkSchedule) are the one list shown on /shifts and in the settings. An employee
 * on one is timed by it: lateness from its start, overtime from its end, under their pay type's rules. Their own
 * custom times win; with neither, the pay type's times apply — exactly as before for everyone not linked.
 */

// A monthly pay type with explicit rules: 6000 / 30 = 200 a day, / 10 hours = 20 an hour.
const monthly: PayTypeRules = {
  ...FALLBACK_PAY_TYPES.monthly,
  id: "pt-monthly",
  workStart: "08:00",
  workEnd: "18:00",
  overtimeStart: "18:00",
  hoursPerDay: 10,
  graceMinutes: 0,
  lateMultiplier: 1.5,
  overtimeMultiplier: 1.5,
  overtimeMinimumMinutes: 60,
  overtimeStepMinutes: 30,
  unauthorizedExitMultiplier: 1.5,
  thursdayRuleEnabled: false,
};
const schedule = (id: string, startTime: string, endTime: string, overtimeStart: string | null = null) => ({
  id, name: id, startTime, endTime, overtimeStart, active: true, sortOrder: 0, deletedAt: null,
});
const ctx: PayContext = {
  payTypes: [{ ...monthly, code: "monthly", active: true, deletedAt: null }],
  schedules: [schedule("ramadan", "09:00", "15:00"), schedule("evening", "16:00", "00:00"), schedule("night", "22:00", "06:00")],
  shifts: [
    { id: "SHIFT-MORNING", name: "الوردية الصباحية", startTime: "08:00", endTime: "18:00", gracePeriodMinutes: 0, workDays: [], allowOvertime: true },
    { id: "SHIFT-EVENING", name: "الوردية المسائية", startTime: "16:00", endTime: "00:00", gracePeriodMinutes: 0, workDays: [], allowOvertime: true },
  ],
  weeklyOffDays: [5],
  holidays: [],
  payPeriodStartDay: 26,
};
const employee = (over: Partial<PayEmployee> = {}): PayEmployee => ({
  id: "e1", shiftId: "SHIFT-MORNING", salaryType: "monthly", payTypeId: "pt-monthly", basicSalary: 6000, ...over,
});
const MON = "2026-10-12";
const TUE = "2026-10-13";
const at = (day: string, time: string) => new Date(`${day}T${time}:00`);

/** What the system posts for a worked day: { kind: amount }. */
function posted(e: PayEmployee, date: string, inAt: Date, outAt: Date) {
  const { deductions, additions } = systemEntriesFor(
    { employeeId: e.id, date, status: "present", actualIn: inAt, actualOut: outAt, scheduledStart: at(date, "08:00") },
    e,
    monthly,
    scheduleFor(ctx, e),
    "workday",
    null,
  );
  return Object.fromEntries([...deductions.map((d) => [d.type, d.amount]), ...additions.map((a) => [a.kind, a.amount])]);
}

describe("an employee on custom working hours (Ramadan 09:00 → 15:00)", () => {
  const e = employee({ workScheduleId: "ramadan" });

  it("lateness counts from 09:00 and overtime from 15:00, at the pay type's multipliers", () => {
    // in 09:20: 20 late minutes × 1.5 = 30 minutes of pay = 10 EGP
    // out 16:30: 90 minutes past 15:00 (≥ 60, in 30-minute steps) × 1.5 = 2.25 hours = 45 EGP
    expect(posted(e, MON, at(MON, "09:20"), at(MON, "16:30"))).toEqual({ late: 10, overtime: 45 });
  });

  it("attendance sees the same day: starts at 09:00, so 09:20 is late", () => {
    const shift = effectiveShift(ctx, e, MON);
    expect([shift.startTime, shift.endTime]).toEqual(["09:00", "15:00"]);
    const day = computeDailyAttendance({ employeeId: e.id, shift, logs: [{ timestamp: at(MON, "09:20").toISOString() }, { timestamp: at(MON, "16:30").toISOString() }] as never, date: MON, isOnApprovedLeave: false });
    expect(day.status).toBe("late");
    expect(day.lateMinutes).toBe(20);
  });

  it("on time and leaving at 15:00 costs and earns nothing", () => {
    expect(posted(e, MON, at(MON, "09:00"), at(MON, "15:00"))).toEqual({});
  });
});

describe("which times apply: the employee's own, then their working hours, then the pay type", () => {
  it("custom times win over linked working hours", () => {
    const e = employee({ workScheduleId: "ramadan", customWorkStart: "07:00", customWorkEnd: "13:00" });
    expect(scheduleFor(ctx, e)).toEqual({ start: "07:00", end: "13:00", overtimeStart: "13:00", source: "custom" });
  });

  it("linked working hours win over the pay type", () => {
    expect(scheduleFor(ctx, employee({ workScheduleId: "ramadan" }))).toEqual({ start: "09:00", end: "15:00", overtimeStart: "15:00", source: "schedule" });
  });

  it("with neither, the pay type's times", () => {
    expect(scheduleFor(ctx, employee())).toEqual({ start: "08:00", end: "18:00", overtimeStart: "18:00", source: "pay_type" });
  });
});

describe("regression: employees not linked to any working hours are calculated exactly as before", () => {
  it("not linked at all: the pay type's 08:00 → 18:00, same amounts as before", () => {
    // in 09:20: 80 late minutes × 1.5 = 2 hours = 40 EGP; out 16:30: 90 minutes early × 1.5 = 2.25 hours = 45 EGP
    expect(posted(employee(), MON, at(MON, "09:20"), at(MON, "16:30"))).toEqual({ late: 40, unauthorized_exit: 45 });
  });

  it("on an old shift (evening) with no working hours: still the pay type's times, as before — the shift never timed anyone", () => {
    const e = employee({ shiftId: "SHIFT-EVENING" });
    expect(scheduleFor(ctx, e)).toEqual({ start: "08:00", end: "18:00", overtimeStart: "18:00", source: "pay_type" });
    expect(posted(e, MON, at(MON, "09:20"), at(MON, "16:30"))).toEqual(posted(employee(), MON, at(MON, "09:20"), at(MON, "16:30")));
  });
});

describe("working hours across midnight", () => {
  it("night 22:00 → 06:00: late from 22:00, overtime after 06:00 the next morning, punches kept on the start day", () => {
    const e = employee({ workScheduleId: "night" });
    const shift = effectiveShift(ctx, e, MON);
    const { scheduledStart, scheduledEnd } = getShiftWindow(MON, shift);
    expect([scheduledStart, scheduledEnd]).toEqual([at(MON, "22:00"), at(TUE, "06:00")]);
    // the 07:30 check-out on Tuesday belongs to Monday's shift
    expect(shiftDaysForPunch(at(TUE, "07:30"), shift)).toContain(MON);
    // 10 late minutes × 1.5 = 0.25 h = 5 EGP; 90 minutes past 06:00 × 1.5 = 2.25 h = 45 EGP
    expect(posted(e, MON, at(MON, "22:10"), at(TUE, "07:30"))).toEqual({ late: 5, overtime: 45 });
  });

  it("evening 16:00 → 00:00: leaving at 01:00 is 60 minutes of overtime", () => {
    const e = employee({ workScheduleId: "evening" });
    // 60 minutes × 1.5 = 1.5 h = 30 EGP
    expect(posted(e, MON, at(MON, "16:00"), at(TUE, "01:00"))).toEqual({ overtime: 30 });
  });
});

// ---------------------------------------------------------------------------------------------------------
// One list on both pages, written through gate(); deleting refuses while employees are on it.

let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/pay-refresh", () => ({ refreshPayCalculations: () => {} }));

const { saveWorkSchedule, deleteWorkSchedule } = await import("@/lib/actions/pay-settings");
const { approveChangeRequest } = await import("@/lib/actions/change-requests");
const { loadScheduleRows } = await import("@/lib/work-schedules");

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}
const ACTOR = "work-schedule-test";
const PREFIX = "اختبار مواعيد";
const admin: User = { id: "U-admin", name: ACTOR, email: "a@x", role: "admin", permissions: [] };

async function cleanUp() {
  const ids = (await prisma.workSchedule.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })).map((s) => s.id);
  await prisma.employee.deleteMany({ where: { workScheduleId: { in: ids }, name: { startsWith: PREFIX } } });
  await prisma.workSchedule.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: { in: [ACTOR, "approver-test"] } } });
  await prisma.changeRequest.deleteMany({ where: { requestedBy: ACTOR } });
}
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const named = async (name: string) => (await loadScheduleRows()).find((s) => s.name === name);

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("one list of working hours on /shifts and in the settings", () => {
  beforeEach(async () => {
    await cleanUp();
    session = admin;
  });

  it("added in the settings, it is on /shifts; added on /shifts, it is in the settings — the same rows", async () => {
    expect(await saveWorkSchedule({}, form({ name: `${PREFIX} 1`, startTime: "09:00", endTime: "15:00", active: "on", from: "settings" }))).toMatchObject({ success: true });
    expect(await saveWorkSchedule({}, form({ name: `${PREFIX} 2`, startTime: "10:00", endTime: "16:00", active: "on", from: "shifts" }))).toMatchObject({ success: true });
    // both pages render loadScheduleRows()
    expect(await named(`${PREFIX} 1`)).toMatchObject({ startTime: "09:00", endTime: "15:00" });
    expect(await named(`${PREFIX} 2`)).toMatchObject({ startTime: "10:00", endTime: "16:00" });
  });

  it("on /shifts: an account with the shifts permission goes through approval; one without it is refused", async () => {
    session = { id: "U-staff", name: ACTOR, email: "s@x", role: "staff", permissions: ["shifts"] };
    expect(await saveWorkSchedule({}, form({ name: `${PREFIX} 3`, startTime: "09:00", endTime: "15:00", active: "on", from: "shifts" }))).toMatchObject({ success: true });
    expect(await named(`${PREFIX} 3`)).toBeUndefined();
    const request = await prisma.changeRequest.findFirstOrThrow({ where: { requestedBy: ACTOR, actionKey: "workSchedules.save", status: "pending" } });
    session = { ...admin, name: "approver-test" };
    expect(await approveChangeRequest(request.id)).toMatchObject({ success: true });
    expect(await named(`${PREFIX} 3`)).toBeTruthy();

    session = { id: "U-other", name: ACTOR, email: "o@x", role: "staff", permissions: ["employees"] };
    expect(await saveWorkSchedule({}, form({ name: `${PREFIX} 4`, startTime: "09:00", endTime: "15:00", from: "shifts" }))).toHaveProperty("error");
    // the settings keep their rule: the main admin only
    session = { id: "U-hr", name: ACTOR, email: "h@x", role: "hr", permissions: ["settings", "shifts"] };
    expect(await saveWorkSchedule({}, form({ name: `${PREFIX} 4`, startTime: "09:00", endTime: "15:00", from: "settings" }))).toHaveProperty("error");
    expect(await named(`${PREFIX} 4`)).toBeUndefined();
  });

  it("deleting working hours employees are on is refused, naming them; otherwise it is a soft delete", async () => {
    await saveWorkSchedule({}, form({ name: `${PREFIX} 5`, startTime: "09:00", endTime: "15:00", active: "on", from: "shifts" }));
    const row = (await named(`${PREFIX} 5`))!;
    const shiftId = (await prisma.shift.findFirstOrThrow()).id;
    const dept = (await prisma.department.findFirstOrThrow()).id;
    const e = await prisma.employee.create({
      // an id that sorts after the seeded "EMP-…" ones (see employee-number-department-move.test.ts)
      data: { id: "ZZ-ZZWS-001", employeeNumber: "ZZWS-001", name: `${PREFIX} موظف`, departmentId: dept, jobTitle: "x", hireDate: new Date("2024-01-01"), shiftId, basicSalary: 6000, workScheduleId: row.id },
    });

    const refused = await deleteWorkSchedule(row.id, "shifts");
    expect(refused.error).toContain(`${PREFIX} موظف`);
    expect((await prisma.workSchedule.findUnique({ where: { id: row.id } }))?.deletedAt).toBeNull();

    await prisma.employee.delete({ where: { id: e.id } });
    expect(await deleteWorkSchedule(row.id, "shifts")).toMatchObject({ success: true });
    const kept = await prisma.workSchedule.findUnique({ where: { id: row.id } });
    expect(kept).toBeTruthy();
    expect(kept!.deletedAt).not.toBeNull();
  });
});
