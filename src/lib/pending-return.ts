import { dedupePunches, permissionKind, type DayPunch } from "@/lib/mid-day-exits";
import { at } from "@/lib/pay-engine";

// THE predicate for "left on a temporary permission and has not come back", read by the bell alert (overdue-return.ts) and
// by the review list (missing-punch-review.ts), so the two can never disagree. Pure; reads no number of its own — the
// permission window and kind come from the existing mid-day helpers. It decides nothing about a charge.

export interface PendingReturn {
  permissionId: string;
  /** The permission's written end. */
  end: Date;
  /** The exit punch still waiting for its return. */
  exitAt: Date;
}

/**
 * The temporary timed permission an employee is out on without a return, at `now`: the day's last punch is an exit (the first
 * punch is the check-in and they alternate, so an even count), it lies before the permission's written end, `now` is past that
 * end, and the permission does not reach the end of the day. A hand-added pair (manual_correction) is not read; a punch HR
 * entered after reviewing (source hr_review) is. Several permissions: the one that ended last.
 */
export function pendingReturn(input: {
  date: string;
  punches: DayPunch[];
  permissions: { id: string; startTime: string; durationMinutes: number }[];
  scheduleStart: string;
  dayEnd: Date;
  now: Date;
}): PendingReturn | null {
  const { date, permissions, scheduleStart, dayEnd, now } = input;
  if (permissions.length === 0) return null;
  const punches = dedupePunches(input.punches.filter((p) => p.source !== "manual_correction"));
  if (punches.length < 2 || punches.length % 2 !== 0) return null;
  const exitAt = punches[punches.length - 1].at;
  const waiting = permissions
    .map((p) => {
      const start = at(date, p.startTime, scheduleStart);
      return { id: p.id, end: new Date(start.getTime() + p.durationMinutes * 60_000), kind: permissionKind(start, p.durationMinutes, dayEnd) };
    })
    .filter((p) => p.kind === "temporary" && exitAt < p.end && now > p.end)
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  return waiting ? { permissionId: waiting.id, end: waiting.end, exitAt } : null;
}
