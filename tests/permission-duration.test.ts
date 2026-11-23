import { describe, expect, it } from "vitest";
import { PRESET_DURATIONS, durationFromUntil, exitWindow } from "@/lib/permission-duration";

/** How long a timed permission lasts, however the form or the classify dialog takes it: preset, minutes, or "until". */
describe("the quick durations", () => {
  it("are 30, 60, 120, 180, 240 and 300 minutes, in that order", () => {
    expect([...PRESET_DURATIONS]).toEqual([30, 60, 120, 180, 240, 300]);
  });
});

describe("until an exact time", () => {
  it.each([
    ["09:00", "09:30", 30],
    ["09:00", "10:00", 60],
    ["08:15", "11:45", 210],
    ["00:00", "23:59", 1439],
    ["12:30", "12:31", 1],
  ])("from %s until %s is %i minutes", (start, until, minutes) => {
    expect(durationFromUntil(start, until)).toEqual({ ok: true, minutes });
  });

  it("refuses a time that is not later than the start, on the same day", () => {
    expect(durationFromUntil("09:00", "09:00")).toEqual({ ok: false, reason: "not_later" });
    expect(durationFromUntil("09:00", "08:59")).toEqual({ ok: false, reason: "not_later" });
    // a permission never runs over midnight: 23:00 until 01:00 is not "2 hours", it is refused
    expect(durationFromUntil("23:00", "01:00")).toEqual({ ok: false, reason: "not_later" });
  });

  it("refuses anything that is not an HH:mm time", () => {
    for (const [start, until] of [["", "10:00"], ["09:00", ""], ["9:00", "10:00"], ["09:00", "24:00"], ["09:00", "10:60"], ["09:00", "ten"]]) {
      expect(durationFromUntil(start, until)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("the permission that covers a stretch out", () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 10, 10, h, m, s);

  it("starts at the minute they left and runs to the minute they came back, rounded up", () => {
    expect(exitWindow(at(7, 52, 6), at(17, 36, 47))).toEqual({ startTime: "07:52", minutes: 585 }); // 584.8 min from 07:52:00
    expect(exitWindow(at(11, 0, 6), at(12, 15, 40))).toEqual({ startTime: "11:00", minutes: 76 });
  });

  it("is never shorter than the stretch: the return is never past the permission's end", () => {
    const out = at(10, 0, 59);
    const back = at(10, 30, 0);
    const { startTime, minutes } = exitWindow(out, back);
    const start = new Date(2026, 10, 10, Number(startTime.slice(0, 2)), Number(startTime.slice(3)));
    expect(start.getTime() + minutes * 60_000).toBeGreaterThanOrEqual(back.getTime());
    expect(exitWindow(at(10, 0, 0), at(10, 30, 0))).toEqual({ startTime: "10:00", minutes: 30 });
  });

  it("is at least a minute", () => {
    expect(exitWindow(at(10, 0, 10), at(10, 0, 20)).minutes).toBe(1);
  });
});
