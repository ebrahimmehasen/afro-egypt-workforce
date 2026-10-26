// Whether a timed permission may be filed (or approved) for an employee's day, and how it will be treated. Pure:
// the day's times, the other permissions and the locked pay months come in as arguments.

import { DayKind, PayTypeRules, ScheduleTimes, at, dayTimes } from "@/lib/pay-engine";
import { PermissionKind, permissionKind } from "@/lib/mid-day-exits";

export type PermissionRefusal = "duration" | "outside_hours" | "overlap" | "day_off" | "locked";

export type PermissionCheck =
  | { ok: true; kind: PermissionKind; start: Date; end: Date; dayStart: Date; dayEnd: Date }
  | { ok: false; reason: PermissionRefusal; dayStart: Date; dayEnd: Date };

const MS_PER_MIN = 60_000;

/**
 * A permission leaves inside the employee's working day (their schedule, with the Thursday rule), lasts more than
 * zero minutes, on a working day of a pay month still open, and doesn't overlap another permission of theirs that
 * day. Its kind follows from its time: ending before the day does, it is temporary; otherwise, leaving early.
 * `others` are the employee's other permissions that day still standing — one without a time (for the rest of the
 * day) overlaps anything.
 */
export function checkTimedPermission(input: {
  date: string;
  startTime: string;
  durationMinutes: number;
  schedule: ScheduleTimes;
  rules: Pick<PayTypeRules, "thursdayRuleEnabled" | "thursdayWorkEnd">;
  dayKind: DayKind;
  locked: boolean;
  others: { startTime?: string | null; durationMinutes?: number | null }[];
}): PermissionCheck {
  const times = dayTimes(input.date, input.schedule, input.rules as PayTypeRules);
  const base = { dayStart: times.start, dayEnd: times.end };
  if (!(input.durationMinutes > 0)) return { ok: false, reason: "duration", ...base };
  if (input.dayKind !== "workday") return { ok: false, reason: "day_off", ...base };
  if (input.locked) return { ok: false, reason: "locked", ...base };
  const start = at(input.date, input.startTime, input.schedule.start);
  if (start < times.start || start >= times.end) return { ok: false, reason: "outside_hours", ...base };
  const end = new Date(start.getTime() + input.durationMinutes * MS_PER_MIN);
  const overlaps = input.others.some((o) => {
    if (!o.startTime || !o.durationMinutes) return true;
    const s = at(input.date, o.startTime, input.schedule.start);
    const e = new Date(s.getTime() + o.durationMinutes * MS_PER_MIN);
    return start < e && s < end;
  });
  if (overlaps) return { ok: false, reason: "overlap", ...base };
  return { ok: true, kind: permissionKind(start, input.durationMinutes, times.end), start, end, ...base };
}
