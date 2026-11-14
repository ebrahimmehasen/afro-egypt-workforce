// The fingerprint device keeps its own clock and stamps every punch with it. That clock does not follow Egypt's
// daylight-saving changes the way the server does, so after a change every punch was an hour off (the first time
// it showed was 2026-10-29, when the clocks went back and the device stayed an hour ahead). These are the pieces
// for reading and setting that clock, kept free of the device connection so they can be tested.

/** A device clock further off than this (seconds) is put right. Seconds of drift are normal and left alone. */
export const MAX_CLOCK_DRIFT_SECONDS = 120;

/** The device packs a moment as a number: ((year-2000) * 12 * 31 + month * 31 + (day-1)) * 86400 + seconds of the day. */
export function encodeDeviceTime(d: Date): number {
  const days = (d.getFullYear() % 100) * 12 * 31 + d.getMonth() * 31 + (d.getDate() - 1);
  return days * 86_400 + d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/** The reverse: the device's wall-clock reading as a Date in the server's local time. */
export function decodeDeviceTime(value: number): Date {
  let t = value;
  const second = t % 60;
  t = (t - second) / 60;
  const minute = t % 60;
  t = (t - minute) / 60;
  const hour = t % 24;
  t = (t - hour) / 24;
  const day = (t % 31) + 1;
  t = (t - (day - 1)) / 31;
  const month = t % 12;
  t = (t - month) / 12;
  return new Date(t + 2000, month, day, hour, minute, second);
}

/** How far ahead of the server the device is, in seconds (negative when it is behind). */
export function clockDriftSeconds(device: Date, server: Date): number {
  return Math.round((device.getTime() - server.getTime()) / 1000);
}

export function needsClockSync(driftSeconds: number): boolean {
  return Math.abs(driftSeconds) > MAX_CLOCK_DRIFT_SECONDS;
}

/**
 * The real moment of a punch the listener got live. The device sends the event the instant the finger is read,
 * so the moment the server receives it is when it happened; the device's own stamp is only as good as its clock.
 * While that clock is right the stamp is kept (to the second, as before); once it is more than the allowed drift
 * off — an hour after a summer-time change it got wrong — the server's moment is used instead.
 */
export function trueRealtimeTime(deviceTime: Date, receivedAt: Date): Date {
  return needsClockSync(clockDriftSeconds(deviceTime, receivedAt)) ? receivedAt : deviceTime;
}

/**
 * The real moment of a punch pulled from the device's log afterwards (after the device was unreachable, say).
 * Its stamp is from the device's clock at the time. When the clock is found `driftSeconds` off now, the punches
 * made since the clock was last known right carry that same error, so it is taken off them; older punches, and
 * any punch at all while the clock is right, keep their stamp.
 */
export function trueLoggedTime(deviceTime: Date, driftSeconds: number, clockRightSince: Date | null): Date {
  if (!needsClockSync(driftSeconds) || !clockRightSince) return deviceTime;
  const corrected = new Date(deviceTime.getTime() - driftSeconds * 1000);
  return corrected.getTime() >= clockRightSince.getTime() ? corrected : deviceTime;
}
