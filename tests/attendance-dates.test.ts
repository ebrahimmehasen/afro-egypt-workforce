import { describe, expect, it } from "vitest";
import { addDays, localDay } from "@/lib/today";
import { shiftDaysForPunch } from "@/lib/attendance-engine";
import { datesInRange } from "@/lib/attendance-service";
import { Shift } from "@/lib/types";

const shift = (startTime: string, endTime: string): Shift => ({
  id: "s",
  name: "s",
  startTime,
  endTime,
  gracePeriodMinutes: 10,
} as Shift);
// a moment given in local wall-clock time, whatever zone the tests run in
const local = (s: string) => new Date(s);

describe("calendar days", () => {
  it("adds days without drifting a day back in a zone ahead of UTC", () => {
    expect(addDays("2026-09-21", 1)).toBe("2026-09-22");
    expect(addDays("2026-09-21", -1)).toBe("2026-09-20");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("names the local day of a moment, including just after midnight", () => {
    expect(localDay(local("2026-09-21T00:30:00"))).toBe("2026-09-21");
    expect(localDay(local("2026-09-21T23:59:00"))).toBe("2026-09-21");
  });

  it("lists every day of a leave, first and last included, and no others", () => {
    expect(datesInRange("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(datesInRange("2026-09-21", "2026-09-21")).toEqual(["2026-09-21"]);
  });
});

describe("shiftDaysForPunch", () => {
  it("puts a day-shift punch on its own day", () => {
    expect(shiftDaysForPunch(local("2026-09-21T07:40:00"), shift("08:00", "16:00"))).toEqual(["2026-09-21"]);
    expect(shiftDaysForPunch(local("2026-09-21T16:05:00"), shift("08:00", "16:00"))).toEqual(["2026-09-21"]);
  });

  it("puts an evening shift's check-out after midnight on the day the shift started", () => {
    expect(shiftDaysForPunch(local("2026-09-22T00:20:00"), shift("16:00", "00:00"))).toEqual(["2026-09-21"]);
  });

  it("puts a night shift's check-in before midnight on the day the shift runs", () => {
    expect(shiftDaysForPunch(local("2026-09-20T23:50:00"), shift("00:00", "08:00"))).toEqual(["2026-09-21"]);
  });
});
