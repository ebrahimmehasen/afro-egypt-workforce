import { describe, expect, it } from "vitest";
import { absenceCandidates, isWorkday } from "@/lib/attendance-engine";
import { Shift } from "@/lib/types";

const morning = { id: "m", name: "morning", startTime: "08:00", endTime: "16:00", gracePeriodMinutes: 10 } as Shift;
const worker = { id: "w1", status: "active", hireDate: "2020-01-01", shiftId: "m", biometricDeviceUserId: "7" };
// 2026-09-21 is a Monday; 2026-09-25 is a Friday
const run = (over: Partial<Parameters<typeof absenceCandidates>[0]> = {}) =>
  absenceCandidates({
    employees: [worker],
    shifts: [morning],
    recorded: new Set(),
    today: "2026-09-21",
    now: new Date("2026-09-21T12:00:00"),
    from: "2026-09-21",
    ...over,
  });

describe("isWorkday", () => {
  it("treats Friday as the only day off", () => {
    expect(isWorkday("2026-09-25")).toBe(false); // Friday
    for (const day of ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-24", "2026-09-26"]) expect(isWorkday(day)).toBe(true);
  });
});

describe("absenceCandidates", () => {
  it("marks a linked worker with no punch today once the shift and its grace have started", () => {
    expect(run()).toEqual([{ employeeId: "w1", date: "2026-09-21" }]);
    expect(run({ now: new Date("2026-09-21T08:05:00") })).toEqual([]); // still within the grace period
  });

  it("leaves alone anyone who already has a record for the day", () => {
    expect(run({ recorded: new Set(["w1|2026-09-21"]) })).toEqual([]);
  });

  it("never marks a Friday", () => {
    expect(run({ today: "2026-09-25", now: new Date("2026-09-25T12:00:00"), from: "2026-09-25" })).toEqual([]);
  });

  it("never marks a public holiday, whether one day or several", () => {
    expect(run({ holidays: [{ from: "2026-09-21", to: "2026-09-21" }] })).toEqual([]);
    const days = run({
      from: "2026-09-21",
      today: "2026-09-24",
      now: new Date("2026-09-24T12:00:00"),
      holidays: [{ from: "2026-09-22", to: "2026-09-23" }],
    }).map((c) => c.date);
    expect(days).toEqual(["2026-09-21", "2026-09-24"]);
    expect(isWorkday("2026-09-22", [{ from: "2026-09-22", to: "2026-09-23" }])).toBe(false);
  });

  it("fills in earlier working days that were missed, skipping Friday", () => {
    const days = run({ from: "2026-09-24", today: "2026-09-26", now: new Date("2026-09-26T12:00:00") }).map((c) => c.date);
    expect(days).toEqual(["2026-09-24", "2026-09-26"]);
  });

  it("skips people who aren't on the device, aren't active, or weren't there yet", () => {
    expect(run({ employees: [{ ...worker, biometricDeviceUserId: null }] })).toEqual([]);
    expect(run({ employees: [{ ...worker, status: "terminated" }] })).toEqual([]);
    expect(run({ employees: [{ ...worker, hireDate: "2026-09-22" }] })).toEqual([]);
  });

  it("counts nothing before the day someone was linked to the device", () => {
    const days = run({
      employees: [{ ...worker, linkedOn: "2026-09-23" }],
      from: "2026-09-21",
      today: "2026-09-23",
      now: new Date("2026-09-23T12:00:00"),
    }).map((c) => c.date);
    expect(days).toEqual(["2026-09-23"]);
  });
});
