// How long a timed permission lasts, as the permission form and the exit-classification dialog offer it: a quick
// choice, any number of minutes, or the time the employee will be back. Pure; the server still stores only
// startTime + durationMinutes (no schema change), so every way of entering it ends as minutes.

/** The quick choices, in minutes. */
export const PRESET_DURATIONS = [30, 60, 120, 180, 240, 300] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export type UntilResult = { ok: true; minutes: number } | { ok: false; reason: "invalid" | "not_later" };

/**
 * The minutes between the time the employee leaves and the time they will be back, the same day. A return that
 * is not later than the departure (or is not an HH:mm time) is refused rather than guessed: a permission never
 * runs over midnight.
 */
export function durationFromUntil(startTime: string, untilTime: string): UntilResult {
  if (!TIME.test(startTime) || !TIME.test(untilTime)) return { ok: false, reason: "invalid" };
  const minutes = minutesOf(untilTime) - minutesOf(startTime);
  return minutes > 0 ? { ok: true, minutes } : { ok: false, reason: "not_later" };
}

/**
 * The permission that exactly covers a stretch the employee was out: it starts at the minute they left (server
 * time, the clock `at()` reads the permission's HH:mm on) and lasts until the minute they came back, rounded up
 * so that the return is never past its end.
 */
export function exitWindow(out: Date, back: Date): { startTime: string; minutes: number } {
  const startOfMinute = new Date(out.getTime() - out.getSeconds() * 1000 - out.getMilliseconds());
  const startTime = `${String(out.getHours()).padStart(2, "0")}:${String(out.getMinutes()).padStart(2, "0")}`;
  return { startTime, minutes: Math.max(1, Math.ceil((back.getTime() - startOfMinute.getTime()) / 60_000)) };
}
