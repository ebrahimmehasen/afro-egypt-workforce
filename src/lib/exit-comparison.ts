// A stretch out of the factory set against its permission: where the permission ends and when the person came
// back. Pure, and nothing is recomputed here: the late minutes are the very number the pay engine charged from
// (ExitInterval.overrunMinutes, before grace), so the day view and the deduction cannot disagree.
import type { ExitInterval } from "@/lib/mid-day-exits";

export interface ExitComparison {
  /** Where the permission ends: its start plus its duration. */
  permittedEnd: Date;
  /** The return punch. */
  back: Date;
  /** Minutes the return is past the permission's end (0 when on time), as the engine computed them. */
  lateMinutes: number;
}

/** Null when the stretch has no permission to compare with, or the person has not come back. */
export function exitComparison(interval: Pick<ExitInterval, "back" | "permission" | "overrunMinutes">): ExitComparison | null {
  const { permission, back } = interval;
  if (!permission || !back) return null;
  return {
    permittedEnd: new Date(new Date(permission.start).getTime() + permission.durationMinutes * 60_000),
    back: new Date(back),
    lateMinutes: interval.overrunMinutes,
  };
}
