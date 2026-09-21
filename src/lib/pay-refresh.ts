import { prisma } from "@/lib/prisma";
import { recalculateOpenDays } from "@/lib/attendance-service";
import { lockedDayCheck, postAttendanceDeductions } from "@/lib/attendance-deductions";
import { loadPayContext } from "@/lib/pay-context";

// Shared through globalThis: this module is compiled into several server bundles, and "one run at a time,
// plus one more if settings changed during it" must hold for the whole process.
const state = ((globalThis as typeof globalThis & { __afroPayRefresh?: { running: boolean; again: boolean } }).__afroPayRefresh ??= {
  running: false,
  again: false,
});

/**
 * After pay settings change (a rule, a pay type, a schedule, an employee's pay setup), brings every day that
 * can still change in line with them: recalculates attendance for days not in an approved or closed pay month,
 * then re-posts their deductions and additions. Locked months keep exactly what they had, and entries someone
 * edited or removed by hand are left as they are. Runs in the background; a change made while it runs queues
 * one more pass.
 */
export function refreshPayCalculations(): void {
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  void (async () => {
    try {
      do {
        state.again = false;
        const [periods, ctx] = await Promise.all([
          prisma.payrollPeriod.findMany({ where: { status: { in: ["approved", "closed"] } } }),
          loadPayContext(),
        ]);
        const days = await recalculateOpenDays(lockedDayCheck(periods, ctx));
        const posted = await postAttendanceDeductions();
        console.log(`[pay-refresh] ${days} day(s) recalculated; entries +${posted.created} ~${posted.updated} -${posted.removed}`);
      } while (state.again);
    } catch (e) {
      console.error("[pay-refresh] failed:", e instanceof Error ? e.message : e);
    } finally {
      state.running = false;
    }
  })();
}
