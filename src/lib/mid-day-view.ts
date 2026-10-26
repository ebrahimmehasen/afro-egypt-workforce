import { prisma } from "@/lib/prisma";
import { punchWindow } from "@/lib/attendance-ingest";
import { timedPermissions } from "@/lib/attendance-deductions";
import { MidDayAnalysis, analyzeMidDay } from "@/lib/mid-day-exits";
import { DayPayInput, at, dayTimes } from "@/lib/pay-engine";
import { PayContext, PayEmployee, effectiveShift, kindOf, rulesFor, scheduleFor } from "@/lib/pay-context";
import { dayStr } from "@/lib/serialize";
import { addDays } from "@/lib/today";

// What the pages read to show the exits in the middle of the day: the same punches and approved timed permissions
// the posting job reads (attendance-deductions.ts), worked out by the same pure engine (mid-day-exits.ts).

export type MidDayInputs = Omit<NonNullable<DayPayInput["midDay"]>, "corrected">;

/** The punches and approved timed permissions of the given employees over the given days, by employee and day. */
export async function loadMidDayInputs(
  ctx: PayContext,
  employees: PayEmployee[],
  dates: string[],
): Promise<(employeeId: string, date: string) => MidDayInputs | undefined> {
  if (employees.length === 0 || dates.length === 0) return () => undefined;
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted.at(-1)!;
  const ids = employees.map((e) => e.id);
  const [logs, leaves] = await Promise.all([
    prisma.attendanceLog.findMany({
      where: { employeeId: { in: ids }, timestamp: { gte: new Date(`${addDays(first, -1)}T00:00:00`), lt: new Date(`${addDays(last, 2)}T00:00:00`) } },
      select: { employeeId: true, timestamp: true, source: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.leave.findMany({
      where: { employeeId: { in: ids }, type: "permission", status: "approved", startTime: { not: null }, from: { lte: new Date(`${last}T00:00:00.000Z`) }, to: { gte: new Date(`${first}T00:00:00.000Z`) } },
    }),
  ]);
  const byId = new Map(employees.map((e) => [e.id, e]));
  return (employeeId, date) => {
    const employee = byId.get(employeeId);
    if (!employee) return undefined;
    const window = punchWindow(date, effectiveShift(ctx, employee, date));
    return {
      punches: logs
        .filter((l) => l.employeeId === employeeId && l.timestamp >= window.gte && l.timestamp <= window.lte)
        .map((l) => ({ at: l.timestamp, source: l.source })),
      permissions: timedPermissions(leaves.filter((l) => l.employeeId === employeeId && dayStr(l.from) <= date && dayStr(l.to) >= date)),
    };
  };
}

/**
 * One day's exits in the middle of the day, for display — null when there is nothing to show (no exit, no timed
 * permission at work, not a working day). `now` lets a day still running show someone out on a permission.
 */
export function midDayForDay(
  ctx: PayContext,
  employee: PayEmployee,
  day: { date: string; actualIn: Date | null; actualOut: Date | null; corrected?: boolean },
  inputs: MidDayInputs | undefined,
  now: Date = new Date(),
): MidDayAnalysis | null {
  if (!inputs || kindOf(ctx, day.date) !== "workday") return null;
  const rules = rulesFor(ctx, employee);
  const schedule = scheduleFor(ctx, employee);
  const a = analyzeMidDay({
    punches: inputs.punches,
    actualIn: day.actualIn,
    actualOut: day.actualOut,
    dayEnd: dayTimes(day.date, schedule, rules).end,
    permissions: inputs.permissions.map((p) => ({ id: p.id, start: at(day.date, p.startTime, schedule.start), durationMinutes: p.durationMinutes })),
    graceMinutes: rules.graceMinutes,
    corrected: day.corrected,
    now,
  });
  return a.intervals.length > 0 || a.finalExit || a.missingPunch || a.outOnPermission ? a : null;
}
