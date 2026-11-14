import { describe, expect, it } from "vitest";
import { MAX_CLOCK_DRIFT_SECONDS, clockDriftSeconds, decodeDeviceTime, encodeDeviceTime, needsClockSync, trueLoggedTime, trueRealtimeTime } from "@/lib/device-clock";

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

describe("a punch stamped by a wrong device clock", () => {
  const received = new Date(2026, 10, 14, 8, 0, 3);

  it("live: the received moment wins once the stamp is more than two minutes off, either way", () => {
    expect(trueRealtimeTime(new Date(2026, 10, 14, 9, 0, 3), received)).toBe(received); // device an hour ahead
    expect(trueRealtimeTime(new Date(2026, 10, 14, 7, 0, 3), received)).toBe(received); // an hour behind
    const close = new Date(2026, 10, 14, 8, 0, 1);
    expect(trueRealtimeTime(close, received)).toBe(close); // seconds apart: the device's stamp, as before
  });

  it("pulled later: the drift found is taken off punches made since the clock was last right, and only those", () => {
    const rightSince = new Date(2026, 10, 14, 7, 50, 0);
    // device an hour ahead: stamped 09:05, really 08:05 — after the clock was last right
    expect(trueLoggedTime(new Date(2026, 10, 14, 9, 5, 0), 3600, rightSince)).toEqual(new Date(2026, 10, 14, 8, 5, 0));
    // a punch from yesterday, stamped while the clock was right, keeps its stamp
    const yesterday = new Date(2026, 10, 13, 8, 0, 0);
    expect(trueLoggedTime(yesterday, 3600, rightSince)).toBe(yesterday);
    // the clock is right: nothing changes; and with no known "right since" nothing is guessed
    const any = new Date(2026, 10, 14, 9, 5, 0);
    expect(trueLoggedTime(any, 30, rightSince)).toBe(any);
    expect(trueLoggedTime(any, 3600, null)).toBe(any);
  });
});
