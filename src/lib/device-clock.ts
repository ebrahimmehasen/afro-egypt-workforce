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
