import { describe, expect, it } from "vitest";
import { canSeeMissingPunchReview, missingPunchReviewDays, type ReviewEmployee, type ReviewRow } from "@/lib/missing-punch-review";
import { lockedDayCheck } from "@/lib/attendance-deductions";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { rulesFor, scheduleFor, type PayContext } from "@/lib/pay-context";
import { dayTimes } from "@/lib/pay-engine";
import type { MidDayInputs } from "@/lib/mid-day-view";
import type { Scope } from "@/lib/scope";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";

/**
 * The review list for days a punch was forgotten on: which days appear (a, b, c) and which must not (outside the
 * viewer's scope, in an approved or closed pay month, not over yet, already corrected). Pure, no database.
 */
const ctx: PayContext = {
  payTypes: [{ ...FALLBACK_PAY_TYPES.monthly, id: "pt", active: true, deletedAt: null }],
  schedules: [],
  shifts: [],
  weeklyOffDays: [5],
  holidays: [],
  payPeriodStartDay: 26,
};
const employee = (id: string, name: string): ReviewEmployee => ({ id, name, shiftId: "s", salaryType: "monthly", payTypeId: "pt", basicSalary: 6000 });
const employees = [employee("E1", "Hossam"), employee("E2", "Mona")];

// 2026-11-16 is a Monday (pay month 11); 2026-11-30 a Monday (pay month 12)
const DAY = "2026-11-16";
const OPEN_DAY = "2026-11-30";
const at = (date: string, time: string) => new Date(`${date}T${time}`);
// the end of the working day comes from the pay type, not from this file
const dayEndOf = (date: string) => dayTimes(date, scheduleFor(ctx, employees[0]), rulesFor(ctx, employees[0])).end;
const allScope: Scope = { all: true };
const noneLocked = () => false;
const afterEverything = new Date("2026-12-31T00:00:00");

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  employeeId: "E1",
  date: DAY,
  status: "present",
  actualIn: at(DAY, "08:00"),
  actualOut: at(DAY, "18:00"),
  ...over,
});
const punches = (date: string, ...times: string[]) => times.map((t) => ({ at: at(date, t), source: "biometric" }));
const run = (rows: ReviewRow[], over: Partial<Parameters<typeof missingPunchReviewDays>[0]> = {}, inputs?: (date: string) => MidDayInputs | undefined) =>
  missingPunchReviewDays({
    rows,
    employees,
    ctx,
    scope: allScope,
    isLocked: noneLocked,
    inputsFor: (_e, date) => inputs?.(date),
    now: afterEverything,
    ...over,
  });

describe("(a) a day whose status is missing_punch", () => {
  it("is listed on a normal working day", () => {
    expect(run([row({ status: "missing_punch", actualOut: null })])).toEqual([{ employeeId: "E1", name: "Hossam", date: DAY, reason: "missing_punch" }]);
  });

  it("is not listed on the weekly day off or a public holiday (2026-11-20 is a Friday)", () => {
    const FRIDAY = "2026-11-20";
    const friday = row({ date: FRIDAY, status: "missing_punch", actualIn: at(FRIDAY, "08:00"), actualOut: null });
    expect(run([friday])).toEqual([]);
    const holiday = { ...ctx, holidays: [{ from: DAY, to: DAY }] };
    expect(run([row({ status: "missing_punch", actualOut: null })], { ctx: holiday })).toEqual([]);
  });
});

describe("(b) an odd number of punches between the first check-in and the last check-out", () => {
  it("is listed: one exit punch with no return", () => {
    const days = run([row()], {}, (d) => ({ punches: punches(d, "08:00", "12:00", "18:00"), permissions: [] }));
    expect(days.map((d) => d.reason)).toEqual(["odd_punches"]);
  });

  it("is not listed when the exits pair up (a day with an exit and its return, or none)", () => {
    expect(run([row()], {}, (d) => ({ punches: punches(d, "08:00", "12:00", "13:00", "18:00"), permissions: [] }))).toEqual([]);
    expect(run([row()], {}, (d) => ({ punches: punches(d, "08:00", "18:00"), permissions: [] }))).toEqual([]);
  });

  it("does not count a punch pressed twice", () => {
    expect(run([row()], {}, (d) => ({ punches: punches(d, "08:00", "12:00:00", "12:00:30", "13:00", "18:00"), permissions: [] }))).toEqual([]);
  });
});

describe("(c) an approved temporary timed permission and no exit punch in the middle of the day", () => {
  const permission = { id: "L1", startTime: "12:00", durationMinutes: 60 };

  it("is listed", () => {
    const days = run([row()], {}, (d) => ({ punches: punches(d, "08:00", "18:00"), permissions: [permission] }));
    expect(days.map((d) => d.reason)).toEqual(["permission_unused"]);
  });

  it("is not listed when the exit and return were punched", () => {
    expect(run([row()], {}, (d) => ({ punches: punches(d, "08:00", "12:05", "13:00", "18:00"), permissions: [permission] }))).toEqual([]);
  });

  it("is not listed for a permission to leave early (it reaches the end of the day, nobody comes back)", () => {
    const end = dayEndOf(DAY);
    const startMinutes = end.getHours() * 60 + end.getMinutes() - 60;
    const startTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
    expect(run([row()], {}, (d) => ({ punches: punches(d, "08:00", "18:00"), permissions: [{ id: "L2", startTime, durationMinutes: 120 }] }))).toEqual([]);
  });
});

describe("what must not appear", () => {
  const odd = () => ({ punches: punches(DAY, "08:00", "12:00", "18:00"), permissions: [] });

  it("a day of an employee outside the viewer's scope", () => {
    const rows = [row({ status: "missing_punch", actualOut: null }), row({ employeeId: "E2", status: "missing_punch", actualOut: null })];
    const inDepartment: Scope = { all: false, ids: new Set(["E2"]) };
    expect(run(rows, { scope: inDepartment }).map((d) => d.employeeId)).toEqual(["E2"]);
    expect(run(rows, { scope: { all: false, ids: new Set() } })).toEqual([]);
    expect(run([row()], { scope: { all: false, ids: new Set(["E2"]) } }, odd)).toEqual([]);
  });

  it("a day in an approved or closed pay month (26 Oct – 25 Nov is pay month 11), while the open month's day appears", () => {
    const isLocked = lockedDayCheck([{ year: 2026, month: 11 }], ctx);
    const rows = [row({ status: "missing_punch", actualOut: null }), row({ date: OPEN_DAY, status: "missing_punch", actualOut: null })];
    expect(run(rows, { isLocked }).map((d) => d.date)).toEqual([OPEN_DAY]);
    // (b) and (c) are held to the same lock
    expect(run([row()], { isLocked }, odd)).toEqual([]);
    expect(run([row()], { isLocked }, () => ({ punches: punches(DAY, "08:00", "18:00"), permissions: [{ id: "L1", startTime: "12:00", durationMinutes: 60 }] }))).toEqual([]);
  });

  it("a day that is not over yet (by the pay type's own day end)", () => {
    const beforeEnd = new Date(dayEndOf(DAY).getTime() - 60_000);
    const afterEnd = new Date(dayEndOf(DAY).getTime() + 60_000);
    const rows = [row({ status: "missing_punch", actualOut: null })];
    expect(run(rows, { now: beforeEnd })).toEqual([]);
    expect(run(rows, { now: afterEnd })).toHaveLength(1);
  });

  it("an ordinary day", () => {
    expect(run([row()], {}, (d) => ({ punches: punches(d, "08:00", "18:00"), permissions: [] }))).toEqual([]);
  });
});

describe("a day HR has corrected", () => {
  const corrected = row({ correctionReason: "forgot to punch out" });
  const permission = { id: "L1", startTime: "12:00", durationMinutes: 60 };

  it("without a temporary permission stays clear (the engine ignores its middle punches, nothing is lost)", () => {
    expect(run([corrected], {}, (d) => ({ punches: punches(d, "08:00", "12:00", "18:00"), permissions: [] }))).toEqual([]);
    expect(run([corrected], {}, (d) => ({ punches: punches(d, "08:00", "18:00"), permissions: [] }))).toEqual([]);
  });

  it("with an approved temporary permission and no reviewed punches stays on the list, even if the device punched an exit and a return", () => {
    expect(run([corrected], {}, (d) => ({ punches: punches(d, "08:00", "18:00"), permissions: [permission] })).map((d) => d.reason)).toEqual(["permission_unused"]);
    // the device's middle punches are not read on a corrected day: they do not clear it
    expect(run([corrected], {}, (d) => ({ punches: punches(d, "08:00", "12:05", "13:00", "18:00"), permissions: [permission] })).map((d) => d.reason)).toEqual(["permission_unused"]);
  });

  it("an early-leave permission on a corrected day is still not listed", () => {
    const end = dayEndOf(DAY);
    const startMinutes = end.getHours() * 60 + end.getMinutes() - 60;
    const startTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
    expect(run([corrected], {}, (d) => ({ punches: punches(d, "08:00", "18:00"), permissions: [{ id: "L2", startTime, durationMinutes: 120 }] }))).toEqual([]);
  });

  it("a corrected day in a locked pay month, or outside the scope, stays off the list", () => {
    const inputs = (d: string) => ({ punches: punches(d, "08:00", "18:00"), permissions: [permission] });
    expect(run([corrected], { isLocked: lockedDayCheck([{ year: 2026, month: 11 }], ctx) }, inputs)).toEqual([]);
    expect(run([corrected], { scope: { all: false, ids: new Set(["E2"]) } }, inputs)).toEqual([]);
  });
});

describe("the list", () => {
  it("has one entry per employee-day, the newest day first", () => {
    const rows = [row({ status: "missing_punch", actualOut: null }), row({ date: OPEN_DAY, employeeId: "E2", status: "missing_punch", actualOut: null })];
    expect(run(rows).map((d) => `${d.date}/${d.employeeId}`)).toEqual([`${OPEN_DAY}/E2`, `${DAY}/E1`]);
  });
});

describe("who is shown it", () => {
  const user = (over: Partial<User>) => ({ id: "U", name: "u", email: "u@x", role: "hr", permissions: [], ...over }) as User;

  it("the admin, and HR holding the leaves or attendance right; nobody else", () => {
    expect(canSeeMissingPunchReview(user({ role: "admin" }))).toBe(true);
    expect(canSeeMissingPunchReview(user({ role: "hr", permissions: ["leaves"] }))).toBe(true);
    expect(canSeeMissingPunchReview(user({ role: "hr", permissions: ["attendance"] }))).toBe(true);
    expect(canSeeMissingPunchReview(user({ role: "hr", permissions: ["employees"] }))).toBe(false);
    expect(canSeeMissingPunchReview(user({ role: "supervisor", permissions: ["leaves", "attendance"] }))).toBe(false);
    expect(canSeeMissingPunchReview(user({ role: "employee", permissions: [] }))).toBe(false);
  });
});

describe("the labels", () => {
  it("exist in Arabic and English, with no numbers", () => {
    for (const dict of [ar, en]) {
      for (const text of [dict.notifications.punchReview, dict.notifications.punchReviewMissing, dict.notifications.punchReviewOdd, dict.notifications.punchReviewPermission]) {
        expect(text.length).toBeGreaterThan(3);
        expect(text).not.toMatch(/[0-9٠-٩]/);
      }
    }
  });
});
