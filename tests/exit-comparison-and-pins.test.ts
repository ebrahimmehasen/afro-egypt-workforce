import { describe, expect, it } from "vitest";
import { analyzeMidDay, permissionKind, type DayPunch, type MidDayInput } from "@/lib/mid-day-exits";
import { exitComparison } from "@/lib/exit-comparison";
import { exitWindow } from "@/lib/permission-duration";
import { ANNOTATION_TAG, annotationKey, latestAnnotations, parseAnnotationKey } from "@/lib/exit-annotation";

/**
 * Part 1: the return comparison shows the engine's own numbers. Part 2: regression pins — what the mid-day exit rules
 * do TODAY, written down so a change to them can't pass unnoticed. They pin the current behaviour; they do not
 * endorse it (the pairing of punches is a policy question the owner has open).
 */
const punch = (iso: string, source = "biometric"): DayPunch => ({ at: new Date(iso), source });
const analyze = ({ punches: iso, dayEnd, ...rest }: Partial<Omit<MidDayInput, "punches" | "dayEnd">> & { punches: string[]; dayEnd: string }) => {
  const punches = iso.map((p) => punch(p));
  return analyzeMidDay({
    punches,
    actualIn: punches[0].at,
    actualOut: punches.length > 1 ? punches.at(-1)!.at : null,
    dayEnd: new Date(dayEnd),
    permissions: [],
    graceMinutes: 0,
    ...rest,
  });
};
const [DAY_IN, DAY_END] = ["2026-11-10T05:00:00.000Z", "2026-11-10T13:30:00.000Z"];

describe("the return comparison", () => {
  const permission = { id: "P1", start: new Date("2026-11-10T07:00:00.000Z"), durationMinutes: 30 };

  it("a return inside the permission: its end, the return, no minutes late", () => {
    const a = analyze({ punches: [DAY_IN, "2026-11-10T07:00:00.000Z", "2026-11-10T07:25:00.000Z", DAY_END], dayEnd: DAY_END, permissions: [permission] });
    const [i] = a.intervals;
    const c = exitComparison(i)!;
    expect(c.permittedEnd.toISOString()).toBe("2026-11-10T07:30:00.000Z");
    expect(c.back.toISOString()).toBe("2026-11-10T07:25:00.000Z");
    expect(c.lateMinutes).toBe(0);
    expect(i.case).toBe(1);
  });

  it("a late return: the minutes late are exactly what the engine charges from (overrunMinutes), grace aside", () => {
    const a = analyze({ punches: [DAY_IN, "2026-11-10T07:00:00.000Z", "2026-11-10T07:50:00.000Z", DAY_END], dayEnd: DAY_END, permissions: [permission], graceMinutes: 5 });
    const [i] = a.intervals;
    const c = exitComparison(i)!;
    expect(c.permittedEnd.toISOString()).toBe("2026-11-10T07:30:00.000Z");
    expect(c.lateMinutes).toBe(20);
    expect(c.lateMinutes).toBe(i.overrunMinutes);
    // the grace comes off before the charge, as for morning lateness: the comparison shows the raw 20, the charge is 15
    expect(i.overrunCharged).toBe(15);
    expect(i.case).toBe(2);
    expect(a.totals.overrunCharged).toBe(15);
  });

  it("has nothing to compare for a stretch without a permission or without a return", () => {
    const none = analyze({ punches: [DAY_IN, "2026-11-10T08:00:00.000Z", "2026-11-10T08:30:00.000Z", DAY_END], dayEnd: DAY_END });
    expect(exitComparison(none.intervals[0])).toBeNull();
    expect(exitComparison({ back: null, permission: { id: "P", start: permission.start, durationMinutes: 30, kind: "temporary" }, overrunMinutes: 0 })).toBeNull();
  });
});

describe("classifying a stretch with a permission covers exactly that stretch", () => {
  it("the permission made from the stretch's window leaves nothing unauthorized and nothing past its end", () => {
    const out = new Date(2026, 10, 10, 8, 0, 6); // local times: the window is read on the server's clock
    const back = new Date(2026, 10, 10, 9, 15, 40);
    const punches = [new Date(2026, 10, 10, 7, 55), out, back, new Date(2026, 10, 10, 15, 0)].map((at) => ({ at, source: "biometric" }));
    const before = analyzeMidDay({ punches, actualIn: punches[0].at, actualOut: punches[3].at, dayEnd: new Date(2026, 10, 10, 15, 30), permissions: [], graceMinutes: 0 });
    expect(before.intervals[0].case).toBe(6);
    expect(before.totals.unauthorizedCharged).toBeGreaterThan(75);

    const { startTime, minutes } = exitWindow(out, back);
    const start = new Date(2026, 10, 10, Number(startTime.slice(0, 2)), Number(startTime.slice(3)));
    const after = analyzeMidDay({
      punches, actualIn: punches[0].at, actualOut: punches[3].at, dayEnd: new Date(2026, 10, 10, 15, 30), graceMinutes: 0,
      permissions: [{ id: "P", start, durationMinutes: minutes }],
    });
    const [i] = after.intervals;
    expect(i.case).toBe(1);
    expect(after.totals).toEqual({ permissionMinutes: expect.closeTo(i.minutes, 5), overrunCharged: 0, unauthorizedCharged: 0 });
  });
});

describe("regression pins: the exit rules as they are today", () => {
  it("the 07:44 / 07:52 pattern: a second punch near arrival is read as going out, and the next punch as the return", () => {
    // مجدى شحاته, 19 Oct: in 07:44:36, again 07:52:06, 17:36:47, last 19:30:29 (Cairo summer time, shown in UTC)
    const a = analyze({
      punches: ["2026-10-19T04:44:36.000Z", "2026-10-19T04:52:06.000Z", "2026-10-19T14:36:47.000Z", "2026-10-19T16:30:29.000Z"],
      dayEnd: "2026-10-19T16:30:00.000Z",
    });
    expect(a.missingPunch).toBe(false);
    expect(a.intervals).toHaveLength(1);
    const [i] = a.intervals;
    expect(i.case).toBe(6);
    expect(i.out.toISOString()).toBe("2026-10-19T04:52:06.000Z");
    expect(i.back!.toISOString()).toBe("2026-10-19T14:36:47.000Z");
    expect(i.minutes).toBeCloseTo(584.68, 1);
    expect(i.unauthorizedCharged).toBeCloseTo(584.68, 1);
  });

  it("three punches within 8 minutes of arrival: the 2nd and 3rd make a 5.9 minute exit; a press within 2 minutes is dropped", () => {
    const three = analyze({
      punches: ["2026-10-19T04:42:39.000Z", "2026-10-19T04:44:48.000Z", "2026-10-19T04:50:43.000Z", "2026-10-19T14:36:24.000Z"],
      dayEnd: "2026-10-19T13:30:00.000Z",
    });
    expect(three.intervals).toHaveLength(1);
    expect(three.intervals[0].minutes).toBeCloseTo(5.92, 1);
    expect(three.intervals[0].case).toBe(6);
    // the same arrival pressed twice 70 seconds apart is one punch
    const twice = analyze({
      punches: ["2026-10-19T04:42:39.000Z", "2026-10-19T04:43:49.000Z", "2026-10-19T14:36:24.000Z"],
      dayEnd: "2026-10-19T13:30:00.000Z",
    });
    expect(twice.intervals).toEqual([]);
    expect(twice.missingPunch).toBe(false);
  });

  it("an odd number of punches in the middle is a missing punch: nothing is charged for exits until HR reviews", () => {
    const a = analyze({ punches: [DAY_IN, "2026-11-10T08:00:00.000Z", DAY_END], dayEnd: DAY_END });
    expect(a.missingPunch).toBe(true);
    expect(a.totals).toEqual({ permissionMinutes: 0, overrunCharged: 0, unauthorizedCharged: 0 });
    // three in the middle is odd as well
    const b = analyze({ punches: [DAY_IN, "2026-11-10T08:00:00.000Z", "2026-11-10T09:00:00.000Z", "2026-11-10T10:00:00.000Z", DAY_END], dayEnd: DAY_END });
    expect(b.missingPunch).toBe(true);
    expect(b.totals.unauthorizedCharged).toBe(0);
  });

  it("a day with one punch has no exits at all", () => {
    const a = analyze({ punches: [DAY_IN], dayEnd: DAY_END });
    expect(a).toMatchObject({ intervals: [], missingPunch: false, finalExit: null, outOnPermission: false });
  });

  it("an exit across midnight is measured by the instants, not by the calendar day", () => {
    // night shift: in 19:55, out 23:30, back 00:20 the next day, last punch 04:05, the day ends 04:00 (UTC instants)
    const night = ["2026-11-10T19:55:00.000Z", "2026-11-10T23:30:00.000Z", "2026-11-11T00:20:00.000Z", "2026-11-11T04:05:00.000Z"];
    const a = analyze({ punches: night, dayEnd: "2026-11-11T04:00:00.000Z" });
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0]).toMatchObject({ case: 6, minutes: 50, unauthorizedCharged: 50 });
    expect(analyze({ punches: night, dayEnd: "2026-11-11T04:00:00.000Z", graceMinutes: 5 }).intervals[0].unauthorizedCharged).toBe(45);
  });

  it("an exit with no permission is charged in full after the grace: current unauthorized-exit behaviour", () => {
    const punches = [DAY_IN, "2026-11-10T11:00:00.000Z", "2026-11-10T12:15:00.000Z", DAY_END];
    expect(analyze({ punches, dayEnd: DAY_END }).totals.unauthorizedCharged).toBe(75);
    expect(analyze({ punches, dayEnd: DAY_END, graceMinutes: 10 }).totals.unauthorizedCharged).toBe(65);
    // and a stretch inside the grace costs nothing
    expect(analyze({ punches: [DAY_IN, "2026-11-10T11:00:00.000Z", "2026-11-10T11:08:00.000Z", DAY_END], dayEnd: DAY_END, graceMinutes: 10 }).totals.unauthorizedCharged).toBe(0);
  });

  it("a permission overrun, and leaving before the permission starts", () => {
    const permission = { id: "P", start: new Date("2026-11-10T07:00:00.000Z"), durationMinutes: 30 };
    const late = analyze({ punches: [DAY_IN, "2026-11-10T07:00:00.000Z", "2026-11-10T07:50:00.000Z", DAY_END], dayEnd: DAY_END, permissions: [permission] });
    expect(late.intervals[0]).toMatchObject({ case: 2, minutes: 50, permissionMinutes: 30, overrunMinutes: 20, overrunCharged: 20, unauthorizedCharged: 0 });
    const early = analyze({ punches: [DAY_IN, "2026-11-10T06:50:00.000Z", "2026-11-10T07:30:00.000Z", DAY_END], dayEnd: DAY_END, permissions: [permission] });
    expect(early.intervals[0]).toMatchObject({ case: 1, minutes: 40, permissionMinutes: 30, unauthorizedMinutes: 10, unauthorizedCharged: 10 });
  });

  it("a permission that reaches the end of the day is leaving early, one minute shorter is temporary", () => {
    const end = new Date("2026-11-10T13:30:00.000Z");
    expect(permissionKind(new Date("2026-11-10T12:30:00.000Z"), 60, end)).toBe("early_leave");
    expect(permissionKind(new Date("2026-11-10T12:30:00.000Z"), 59, end)).toBe("temporary");
  });

  it("a hand-added in/out pair (manual correction) is never read as an exit", () => {
    const punches: DayPunch[] = [punch(DAY_IN), { at: new Date("2026-11-10T08:00:00.000Z"), source: "manual_correction" }, { at: new Date("2026-11-10T09:00:00.000Z"), source: "manual_correction" }, punch(DAY_END)];
    const a = analyzeMidDay({ punches, actualIn: punches[0].at, actualOut: punches[3].at, dayEnd: new Date(DAY_END), permissions: [], graceMinutes: 0 });
    expect(a.intervals).toEqual([]);
  });
});

describe("the record-only note on an exit", () => {
  const key = { employeeId: "EMP-1", date: "2026-11-10", out: "2026-11-10T08:00:00.000Z", back: "2026-11-10T09:00:00.000Z", type: "mission" as const };

  it("round-trips through its key, and only its own tag is read", () => {
    expect(parseAnnotationKey(annotationKey(key))).toEqual(key);
    expect(annotationKey(key).startsWith(`${ANNOTATION_TAG}|`)).toBe(true);
    for (const other of ["-", "", "x|y", `${ANNOTATION_TAG}|EMP-1|2026-11-10|a|b|permission`, "approve|EMP-1|2026-11-10|a|b|mission"]) {
      expect(parseAnnotationKey(other)).toBeNull();
    }
  });

  it("keeps the latest note per stretch and ignores every other audit entry", () => {
    const entry = (oldValue: string, userName: string, at: string, reason: string | null) => ({ oldValue, userName, timestamp: new Date(at), reason });
    const notes = latestAnnotations([
      entry(annotationKey(key), "HR-1", "2026-11-11T08:00:00Z", "first"),
      entry(annotationKey({ ...key, type: "excused_absence" }), "HR-2", "2026-11-11T09:00:00Z", "second"),
      entry("-", "x", "2026-11-11T10:00:00Z", null),
    ]);
    expect(notes.size).toBe(1);
    expect(notes.get("EMP-1|2026-11-10|2026-11-10T08:00:00.000Z")).toMatchObject({ type: "excused_absence", by: "HR-2", reason: "second" });
  });
});
