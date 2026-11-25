import { describe, expect, it } from "vitest";
import { HR_REVIEW_SOURCE, analyzeMidDay, type DayPunch, type MidDayInput, type TimedPermission } from "@/lib/mid-day-exits";
import { analyzeMidDay as analyzeMidDayBefore } from "./fixtures/mid-day-exits.before";
import { computeDayPay, type PayTypeRules } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { hrReviewPayload, isHrReviewPayload, punchEngineSource, reviewedTimes } from "@/lib/hr-review-punch";

/**
 * The punches HR enters after reviewing a day: the engine reads them as ordinary mid-day punches — also on a day HR has
 * corrected, where every other middle punch is still ignored — and every day without one is worked out exactly as before
 * (a frozen copy of the engine from before this change, tests/fixtures/mid-day-exits.before.ts, is compared on a grid).
 */
const DAY = "2026-11-16"; // a Monday
const at = (time: string) => new Date(`${DAY}T${time}`);
const device = (...times: string[]): DayPunch[] => times.map((t) => ({ at: at(t), source: "biometric" }));
const reviewed = (...times: string[]): DayPunch[] => times.map((t) => ({ at: at(t), source: HR_REVIEW_SOURCE }));
const manual = (...times: string[]): DayPunch[] => times.map((t) => ({ at: at(t), source: "manual_correction" }));
const permission = (start: string, durationMinutes: number): TimedPermission => ({ id: `P-${start}`, start: at(start), durationMinutes });

const base = (over: Partial<MidDayInput> = {}): MidDayInput => ({
  punches: device("08:00", "17:00"),
  actualIn: at("08:00"),
  actualOut: at("17:00"),
  dayEnd: at("16:30"),
  permissions: [],
  graceMinutes: 5,
  ...over,
});

describe("a day without reviewed punches is worked out exactly as before", () => {
  const punchSets: Record<string, DayPunch[]> = {
    none: device("08:00", "17:00"),
    paired: device("08:00", "12:00", "13:10", "17:00"),
    odd: device("08:00", "12:00", "17:00"),
    twoExits: device("08:00", "10:00", "10:20", "12:00", "13:10", "17:00"),
    pressedTwice: device("08:00", "12:00:00", "12:00:40", "13:10", "17:00"),
    handAddedPair: [...device("08:00", "17:00"), ...manual("12:00", "12:30")],
    handAddedOdd: [...device("08:00", "17:00"), ...manual("12:00")],
    nearEnds: device("08:00", "08:01", "16:59", "17:00"),
  };
  const permissionSets: Record<string, TimedPermission[]> = {
    none: [],
    temporary: [permission("12:00", 60)],
    temporaryLate: [permission("11:00", 30)],
    early: [permission("15:30", 120)],
    both: [permission("12:00", 60), permission("15:30", 120)],
  };
  const cases = Object.entries(punchSets).flatMap(([p, punches]) =>
    Object.entries(permissionSets).flatMap(([q, permissions]) =>
      [false, true].flatMap((corrected) => [undefined, at("12:30"), at("18:00")].map((now) => ({ name: `${p} / ${q} / corrected=${corrected} / now=${now?.toISOString() ?? "none"}`, input: base({ punches, permissions, corrected, now }) }))),
    ),
  );

  it("covers a real grid of days", () => {
    expect(cases.length).toBeGreaterThan(200);
  });

  it("gives byte-for-byte the same analysis as the engine before the change, on every one", () => {
    for (const { name, input } of cases) {
      expect(JSON.stringify(analyzeMidDay(input)), name).toBe(JSON.stringify(analyzeMidDayBefore(input)));
    }
  });
});

describe("a reviewed pair on a day with a permission", () => {
  it("is an ordinary exit and return: it uses the permission and nothing else is charged as unauthorized", () => {
    const a = analyzeMidDay(base({ punches: [...device("08:00", "17:00"), ...reviewed("12:10", "12:50")], permissions: [permission("12:00", 60)] }));
    expect(a.missingPunch).toBe(false);
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0]).toMatchObject({ case: 1, minutes: 40, permissionMinutes: 40, overrunMinutes: 0, unauthorizedMinutes: 0 });
  });

  it("without the permission it is an exit without permission, charged by the existing rule", () => {
    const a = analyzeMidDay(base({ punches: [...device("08:00", "17:00"), ...reviewed("12:10", "12:50")] }));
    expect(a.intervals[0]).toMatchObject({ case: 6, minutes: 40, unauthorizedMinutes: 40 });
  });

  it("a lone reviewed punch is still an odd day (nothing is charged until it is complete)", () => {
    const a = analyzeMidDay(base({ punches: [...device("08:00", "17:00"), ...reviewed("12:10")] }));
    expect(a.missingPunch).toBe(true);
    expect(a.totals).toEqual({ permissionMinutes: 0, overrunCharged: 0, unauthorizedCharged: 0 });
  });

  it("a reviewed return completes the pair of a device exit", () => {
    const a = analyzeMidDay(base({ punches: [...device("08:00", "12:10", "17:00"), ...reviewed("12:50")], permissions: [permission("12:00", 60)] }));
    expect(a.missingPunch).toBe(false);
    expect(a.intervals[0]).toMatchObject({ case: 1, minutes: 40 });
  });
});

describe("a day HR corrected", () => {
  const corrected = { corrected: true };

  it("still ignores the device's middle punches", () => {
    const a = analyzeMidDay(base({ ...corrected, punches: device("08:00", "12:00", "13:30", "17:00"), permissions: [permission("12:00", 60)] }));
    expect(a.intervals).toEqual([]);
    expect(a.missingPunch).toBe(false);
  });

  it("still ignores a pair added by hand (manual_correction)", () => {
    const a = analyzeMidDay(base({ ...corrected, punches: [...device("08:00", "17:00"), ...manual("12:00", "12:30")] }));
    expect(a.intervals).toEqual([]);
  });

  it("reads the reviewed punches, and only those, among device punches it ignores", () => {
    const a = analyzeMidDay(base({ ...corrected, punches: [...device("08:00", "11:00", "11:30", "17:00"), ...reviewed("12:10", "12:50")], permissions: [permission("12:00", 60)] }));
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0]).toMatchObject({ case: 1, minutes: 40, permissionMinutes: 40 });
  });

  it("a device punch right beside a reviewed one does not swallow it", () => {
    const a = analyzeMidDay(base({ ...corrected, punches: [...device("08:00", "12:09", "17:00"), ...reviewed("12:10", "12:50")] }));
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0].minutes).toBe(40);
  });
});

describe("the charge comes out of the existing calculation (Settings), with no number of its own", () => {
  const rules: PayTypeRules = { ...FALLBACK_PAY_TYPES.monthly, id: "pt", hoursPerDay: 10, graceMinutes: 0, permissionMultiplier: 1.25, unauthorizedExitMultiplier: 1.75, permissionOverrunMultiplier: 2.25 };
  const schedule = { start: "08:00", end: "16:30", overtimeStart: "16:30" };
  const day = (midDay: NonNullable<Parameters<typeof computeDayPay>[0]["midDay"]>) =>
    computeDayPay({ date: DAY, kind: "workday", schedule, rules, pay: { basicSalary: 6000 }, actualIn: at("08:00"), actualOut: at("16:30"), hasPermission: false, midDay });
  const item = (pay: ReturnType<typeof computeDayPay>, kind: string) => pay.items.find((i) => i.kind === kind);
  const permissions = [{ id: "L1", startTime: "12:00", durationMinutes: 60 }];

  it("a reviewed pair inside the permission is charged at the permission multiplier from the pay type", () => {
    const pay = day({ punches: [...device("08:00", "16:30"), ...reviewed("12:10", "12:50")], permissions });
    expect(item(pay, "permission")).toMatchObject({ minutes: 40, multiplier: rules.permissionMultiplier });
    expect(item(pay, "unauthorized_exit")).toBeUndefined();
    expect(item(pay, "permission_overrun")).toBeUndefined();
  });

  it("a reviewed pair running past the permission: the overrun at the overrun multiplier", () => {
    const pay = day({ punches: [...device("08:00", "16:30"), ...reviewed("12:10", "13:30")], permissions });
    expect(item(pay, "permission")).toMatchObject({ minutes: 60, multiplier: rules.permissionMultiplier });
    expect(item(pay, "permission_overrun")).toMatchObject({ minutes: 20, multiplier: rules.permissionOverrunMultiplier });
  });

  it("the same on a corrected day, where the device's own middle punches change nothing", () => {
    const pay = day({ corrected: true, punches: [...device("08:00", "11:00", "11:40", "16:30"), ...reviewed("12:10", "12:50")], permissions });
    expect(item(pay, "permission")).toMatchObject({ minutes: 40, multiplier: rules.permissionMultiplier });
    expect(item(pay, "unauthorized_exit")).toBeUndefined();
  });

  it("a corrected day with no reviewed punch has no exit charge at all (unchanged)", () => {
    const pay = day({ corrected: true, punches: device("08:00", "11:00", "11:40", "16:30"), permissions });
    expect(item(pay, "unauthorized_exit")).toBeUndefined();
    expect(item(pay, "permission")).toBeUndefined();
  });
});

describe("reviewed punches as stored", () => {
  it("are recognised by their marker, and given the engine source hr_review", () => {
    const payload = hrReviewPayload({ by: "HR", reason: "manager confirmed", at: "2026-11-25T10:00:00.000Z", role: "out" });
    expect(isHrReviewPayload(payload)).toBe(true);
    expect(punchEngineSource({ source: "manual_correction", rawPayload: payload })).toBe(HR_REVIEW_SOURCE);
  });

  it("a hand-added or device punch keeps its own source", () => {
    expect(punchEngineSource({ source: "manual_correction", rawPayload: null })).toBe("manual_correction");
    expect(punchEngineSource({ source: "biometric", rawPayload: { raw: "x" } })).toBe("biometric");
    expect(isHrReviewPayload({ hrReview: "nope" })).toBe(false);
    expect(isHrReviewPayload(null)).toBe(false);
  });
});

describe("the times HR may enter", () => {
  const day = { date: DAY, actualIn: at("08:00"), actualOut: at("17:00"), existing: [at("08:00"), at("17:00")] };

  it("takes an exit and a return strictly inside the day", () => {
    const r = reviewedTimes({ ...day, outTime: "12:10", backTime: "12:50" });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.out?.getTime()).toBe(at("12:10").getTime());
    expect(r.ok && r.back?.getTime()).toBe(at("12:50").getTime());
  });

  it("takes just one of them", () => {
    expect(reviewedTimes({ ...day, outTime: "12:10" })).toMatchObject({ ok: true, back: null });
    expect(reviewedTimes({ ...day, backTime: "12:50" })).toMatchObject({ ok: true, out: null });
  });

  it("refuses: neither time, a bad time, a return before the exit, outside the day, on top of a punch", () => {
    expect(reviewedTimes({ ...day })).toEqual({ ok: false, error: "needOne" });
    expect(reviewedTimes({ ...day, outTime: "25:00" })).toEqual({ ok: false, error: "badTime" });
    expect(reviewedTimes({ ...day, outTime: "13:00", backTime: "12:00" })).toEqual({ ok: false, error: "backBeforeOut" });
    expect(reviewedTimes({ ...day, outTime: "07:00" })).toEqual({ ok: false, error: "outsideDay" });
    expect(reviewedTimes({ ...day, backTime: "17:30" })).toEqual({ ok: false, error: "outsideDay" });
    expect(reviewedTimes({ ...day, outTime: "08:01" })).toEqual({ ok: false, error: "outsideDay" }); // the day's own in and out never move
    expect(reviewedTimes({ ...day, existing: [...day.existing, at("12:00")], outTime: "12:01" })).toEqual({ ok: false, error: "duplicate" });
    expect(reviewedTimes({ ...day, actualOut: null, outTime: "12:00" })).toEqual({ ok: false, error: "outsideDay" });
  });
});
