import { describe, expect, it } from "vitest";
import { MAX_CLOCK_DRIFT_SECONDS, clockDriftSeconds, decodeDeviceTime, encodeDeviceTime, needsClockSync } from "@/lib/device-clock";

describe("the device clock", () => {
  it("packs and unpacks a moment the way the device does", () => {
    const d = new Date(2026, 10, 1, 10, 32, 6); // 2026-11-01 10:32:06 local
    expect(decodeDeviceTime(encodeDeviceTime(d)).getTime()).toBe(d.getTime());
    // a reading taken from the real device: 2026-11-01 11:30:36
    const raw = ((26 * 12 * 31 + 10 * 31 + 0) * 86_400) + 11 * 3600 + 30 * 60 + 36;
    expect(decodeDeviceTime(raw)).toEqual(new Date(2026, 10, 1, 11, 30, 36));
  });

  it("measures how far ahead the device is", () => {
    const server = new Date(2026, 10, 1, 10, 30, 0);
    expect(clockDriftSeconds(new Date(2026, 10, 1, 11, 30, 0), server)).toBe(3600);
    expect(clockDriftSeconds(new Date(2026, 10, 1, 10, 29, 0), server)).toBe(-60);
  });

  it("puts right an hour out, either way, but leaves seconds of drift alone", () => {
    expect(needsClockSync(3600)).toBe(true);
    expect(needsClockSync(-3600)).toBe(true);
    expect(needsClockSync(MAX_CLOCK_DRIFT_SECONDS)).toBe(false);
    expect(needsClockSync(45)).toBe(false);
  });
});
