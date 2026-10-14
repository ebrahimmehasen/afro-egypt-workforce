import { postAttendanceDeductions } from "@/lib/attendance-deductions";
import { recalculateOpenPayrollPeriods } from "@/lib/payroll-recalc";

/**
 * The one way the system brings pay in line with attendance: post the finished days' deductions and additions
 * (attendance-deductions.ts), then — if anything changed — recalculate the payroll periods that are calculated but
 * not yet approved, so a new deduction reaches the payslips without anyone pressing "حساب الرواتب" again.
 * Approved and closed periods are never touched.
 *
 * Every caller goes through this queue — the device catch-up, the 10-minute timer that runs even while the device
 * is offline, a settings change, and a leave decision / attendance correction / manual deduction — so two runs
 * never post the same day at once. Kept on globalThis: this module is bundled into several server chunks.
 */
const state = ((globalThis as typeof globalThis & { __afroAttendanceEffects?: { tail: Promise<unknown> } }).__afroAttendanceEffects ??= {
  tail: Promise.resolve(),
});

export interface AttendanceEffectsResult {
  created: number;
  updated: number;
  removed: number;
  /** payroll periods recalculated */
  periods: number;
}

/**
 * Runs (after any run already in progress) and resolves with what changed. `payrollChanged` forces the payroll
 * recalculation even when the posting itself changed nothing — for a deduction someone added or edited by hand.
 */
export function runAttendanceEffects(opts: { payrollChanged?: boolean } = {}): Promise<AttendanceEffectsResult> {
  const run = state.tail.then(async () => {
    const posted = await postAttendanceDeductions();
    const changed = posted.created + posted.updated + posted.removed > 0 || Boolean(opts.payrollChanged);
    const periods = changed ? await recalculateOpenPayrollPeriods() : 0;
    if (changed) {
      console.log(`[attendance-effects] entries +${posted.created} ~${posted.updated} -${posted.removed}; payroll periods recalculated: ${periods}`);
    }
    return { ...posted, periods };
  });
  state.tail = run.catch(() => undefined);
  return run;
}

/** Fire-and-forget form for a request that shouldn't wait for it (a leave decision, a correction…). */
export function scheduleAttendanceEffects(opts: { payrollChanged?: boolean } = {}): void {
  void runAttendanceEffects(opts).catch((e) =>
    console.error("[attendance-effects] failed:", e instanceof Error ? e.message : e),
  );
}
