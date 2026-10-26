// Leaving the factory in the middle of the day, read off the fingerprint punches. Pure — no database and no
// clock — and no rule value lives here: the grace comes from the pay type (the same graceMinutes the morning
// lateness uses) and the multipliers are applied by the pay engine (computeDayPay).
//
// Workers don't punch for breaks, so a punch out and a punch back in between the day's first check-in and its
// last check-out is a real exit. Each one is matched to the day's approved timed permission (if any) and split,
// minute by minute, into exactly one of: time on the permission, time past it, or time out without permission.

/** Punches this close to the one before them are the same punch pressed twice: they count once. */
export const DUPLICATE_PUNCH_MS = 2 * 60_000;

const MS_PER_MIN = 60_000;

export interface DayPunch {
  at: Date;
  /** "biometric", "manual_correction"… — an HR in/out pair added by hand is never read as a mid-day exit. */
  source?: string;
}

/** An approved permission with a time: it starts at `start` and lasts `durationMinutes`. */
export interface TimedPermission {
  id: string;
  start: Date;
  durationMinutes: number;
}

/**
 * A temporary permission ends before the working day does — the employee is expected back. One that reaches
 * the end of the day (or past it) is a permission to leave early: nobody waits for them to come back.
 */
export type PermissionKind = "temporary" | "early_leave";

export function permissionKind(start: Date, durationMinutes: number, dayEnd: Date): PermissionKind {
  return start.getTime() + durationMinutes * MS_PER_MIN >= dayEnd.getTime() ? "early_leave" : "temporary";
}

/** Grace applied exactly as the morning lateness applies it: only the minutes after it count. */
export function afterGrace(minutes: number, graceMinutes: number): number {
  return minutes > graceMinutes ? minutes - graceMinutes : 0;
}

/**
 * One stretch out of the factory and what it was charged as. `case` is the row of the rules table:
 *  1 — temporary permission, back within it;  2 — temporary permission, back after it;
 *  3 — temporary permission, never back;      5 — permission to leave early, left before it started;
 *  6 — out and back with no permission.
 * (4 — leaving on a permission to leave early — is the end-of-day permission rule; 7 is `missingPunch`.)
 */
export interface ExitInterval {
  case: 1 | 2 | 3 | 5 | 6;
  out: Date;
  /** null: never came back (case 3), or left for the day (case 5). */
  back: Date | null;
  /** Minutes actually out (to the end of the day when they didn't come back). */
  minutes: number;
  permission: { id: string; start: Date; durationMinutes: number; kind: PermissionKind } | null;
  /** Minutes on the permission (charged at the permission multiplier). */
  permissionMinutes: number;
  /** Minutes past a temporary permission, before grace, and the part that is charged. */
  overrunMinutes: number;
  overrunCharged: number;
  /** Minutes out without permission, before grace, and the part that is charged. */
  unauthorizedMinutes: number;
  unauthorizedCharged: number;
}

export interface MidDayAnalysis {
  intervals: ExitInterval[];
  /**
   * An odd number of punches in the middle of the day: an exit without its return (or a return without its exit).
   * Like a day with one punch, nothing is charged for the mid-day exits until HR reviews it.
   */
  missingPunch: boolean;
  /**
   * How the last check-out is charged when a timed permission covers it (cases 3, 4 and 5). Null: the end-of-day
   * rule as before (the permission for the rest of the day, or leaving without permission).
   */
  finalExit: FinalExit | null;
  /** Today only: out on a temporary permission that hasn't run out yet. */
  outOnPermission: boolean;
  totals: { permissionMinutes: number; overrunCharged: number; unauthorizedCharged: number };
}

export interface FinalExit {
  case: 3 | 4 | 5;
  out: Date;
  permission: { id: string; start: Date; durationMinutes: number; kind: PermissionKind };
  /** Minutes from the check-out to the end of the day. */
  minutes: number;
  /** Before the permission started (charged as leaving without permission, after grace). */
  beforeMinutes: number;
  beforeCharged: number;
  /** On the permission. */
  permissionMinutes: number;
  /** Case 3: the rest of the day after the temporary permission ran out, charged as leaving without permission. */
  afterMinutes: number;
}

export interface MidDayInput {
  /** Every punch read for the day's window, any order. */
  punches: DayPunch[];
  /** The day's check-in / check-out as recorded (an HR correction's when the day was corrected). */
  actualIn: Date | null;
  actualOut: Date | null;
  /** The end of the working day (dayTimes, with the Thursday rule). */
  dayEnd: Date;
  permissions: TimedPermission[];
  graceMinutes: number;
  /** Corrected by HR: their check-in and check-out stand, and the punches in between are not read. */
  corrected?: boolean;
  /** For "out on permission" on a day still running. */
  now?: Date;
}

const minutesBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / MS_PER_MIN);
const endOf = (p: TimedPermission) => new Date(p.start.getTime() + p.durationMinutes * MS_PER_MIN);

/** Sorted, with a punch pressed again within DUPLICATE_PUNCH_MS of the one kept before it dropped. */
export function dedupePunches(punches: DayPunch[]): DayPunch[] {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: DayPunch[] = [];
  for (const p of sorted) {
    const last = out.at(-1);
    if (last && p.at.getTime() - last.at.getTime() < DUPLICATE_PUNCH_MS) continue;
    out.push(p);
  }
  return out;
}

/**
 * Splits one stretch out (from `out` for `minutes`) against a permission: the minutes before the permission
 * started are without permission; from then on, up to its duration is on the permission and the rest is past it.
 */
function splitAgainst(out: Date, minutes: number, p: TimedPermission) {
  const before = Math.min(minutes, minutesBetween(out, p.start));
  const rest = minutes - before;
  const onPermission = Math.min(rest, p.durationMinutes);
  return { before, onPermission, past: rest - onPermission };
}

/** Does a stretch [out, back] touch the permission's window at all? Only then is it that permission's. */
const overlaps = (out: Date, back: Date, p: TimedPermission) => out.getTime() < endOf(p).getTime() && back.getTime() > p.start.getTime();

export function analyzeMidDay(input: MidDayInput): MidDayAnalysis {
  const { actualIn, actualOut, dayEnd, graceMinutes } = input;
  const kindOf = (p: TimedPermission) => permissionKind(p.start, p.durationMinutes, dayEnd);
  const described = (p: TimedPermission) => ({ id: p.id, start: p.start, durationMinutes: p.durationMinutes, kind: kindOf(p) });
  const empty: MidDayAnalysis = { intervals: [], missingPunch: false, finalExit: null, outOnPermission: false, totals: { permissionMinutes: 0, overrunCharged: 0, unauthorizedCharged: 0 } };
  if (!actualIn) return empty;

  const punches = dedupePunches(input.punches);
  const permissions = [...input.permissions].filter((p) => p.durationMinutes > 0).sort((a, b) => a.start.getTime() - b.start.getTime());
  const used = new Set<string>();

  // ---- the stretches out between the first check-in and the last check-out
  const intervals: ExitInterval[] = [];
  let missingPunch = false;
  // A day still running whose punches after the check-in are odd: the last one is someone coming back, not
  // leaving for the day — so it closes the stretch out before it and there is no check-out yet.
  const running = Boolean(input.now && input.now < dayEnd);
  let lastOut: Date | null = actualOut;
  if (actualOut && !input.corrected) {
    const inMs = actualIn.getTime();
    const outMs = actualOut.getTime();
    const middle = punches.filter(
      (p) =>
        p.source !== "manual_correction" &&
        p.at.getTime() - inMs >= DUPLICATE_PUNCH_MS &&
        outMs - p.at.getTime() >= DUPLICATE_PUNCH_MS,
    );
    if (middle.length % 2 === 1 && running) {
      middle.push({ at: actualOut });
      lastOut = null;
    }
    if (middle.length % 2 === 1) missingPunch = true;
    else {
      for (let i = 0; i < middle.length; i += 2) {
        const out = middle[i].at;
        const back = middle[i + 1].at;
        const minutes = minutesBetween(out, back);
        // the permission it belongs to: one whose time it touches, the nearest to the exit; a temporary one is used once
        const candidates = permissions.filter((p) => overlaps(out, back, p) && !(kindOf(p) === "temporary" && used.has(p.id)));
        const permission = candidates.sort((a, b) => Math.abs(a.start.getTime() - out.getTime()) - Math.abs(b.start.getTime() - out.getTime()))[0];
        if (!permission) {
          intervals.push({ case: 6, out, back, minutes, permission: null, permissionMinutes: 0, overrunMinutes: 0, overrunCharged: 0, unauthorizedMinutes: minutes, unauthorizedCharged: afterGrace(minutes, graceMinutes) });
          continue;
        }
        used.add(permission.id);
        const split = splitAgainst(out, minutes, permission);
        intervals.push({
          case: split.past > 0 ? 2 : 1,
          out,
          back,
          minutes,
          permission: described(permission),
          permissionMinutes: split.onPermission,
          overrunMinutes: split.past,
          overrunCharged: afterGrace(split.past, graceMinutes),
          unauthorizedMinutes: split.before,
          unauthorizedCharged: afterGrace(split.before, graceMinutes),
        });
      }
    }
  }

  // ---- the last check-out, when a timed permission covers it
  let finalExit: FinalExit | null = null;
  if (lastOut && lastOut < dayEnd) {
    const toEnd = minutesBetween(lastOut, dayEnd);
    // a permission to leave early covers the check-out however it was used before; a temporary one only if still unused
    const early = permissions.filter((p) => kindOf(p) === "early_leave").at(-1);
    const temporary = permissions
      .filter((p) => kindOf(p) === "temporary" && !used.has(p.id) && lastOut.getTime() < endOf(p).getTime())
      .sort((a, b) => Math.abs(a.start.getTime() - lastOut.getTime()) - Math.abs(b.start.getTime() - lastOut.getTime()))[0];
    if (early) {
      const before = Math.min(toEnd, minutesBetween(lastOut, early.start));
      finalExit = { case: before > 0 ? 5 : 4, out: lastOut, permission: described(early), minutes: toEnd, beforeMinutes: before, beforeCharged: afterGrace(before, graceMinutes), permissionMinutes: toEnd - before, afterMinutes: 0 };
    } else if (temporary) {
      used.add(temporary.id);
      const split = splitAgainst(lastOut, toEnd, temporary);
      finalExit = { case: 3, out: lastOut, permission: described(temporary), minutes: toEnd, beforeMinutes: split.before, beforeCharged: afterGrace(split.before, graceMinutes), permissionMinutes: split.onPermission, afterMinutes: split.past };
    }
  }

  // ---- a day still running: out on a temporary permission that hasn't run out
  let outOnPermission = false;
  if (running && input.now && lastOut && finalExit?.case === 3) {
    const back = Math.max(lastOut.getTime(), finalExit.permission.start.getTime()) + finalExit.permission.durationMinutes * MS_PER_MIN;
    outOnPermission = input.now.getTime() < back;
  }

  const counted = missingPunch ? [] : intervals;
  const totals = {
    permissionMinutes: counted.reduce((s, i) => s + i.permissionMinutes, 0),
    overrunCharged: counted.reduce((s, i) => s + i.overrunCharged, 0),
    unauthorizedCharged: counted.reduce((s, i) => s + i.unauthorizedCharged, 0),
  };
  return { intervals, missingPunch, finalExit, outOnPermission, totals };
}
