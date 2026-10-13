import { prisma } from "@/lib/prisma";
import { dayKind, parseWeeklyOffDays } from "@/lib/pay-engine";
import { FALLBACK_WEEKLY_OFF_DAYS } from "@/lib/pay-defaults";
import { ABSENCE_TRACKING_FROM } from "@/lib/attendance-engine";
import { dayStr } from "@/lib/serialize";
import type { BalanceLeave, DayKindOf } from "@/lib/leave-balance";

/**
 * Reads the weekly day off (Settings → attendance) and the public holidays once, and returns what kind of day a
 * date is — the same two sources and the same answer the pay rules use, so the leave balance and pay always agree
 * on which days are Fridays and holidays.
 */
export async function loadDayKindRule(): Promise<DayKindOf> {
  const [attendance, holidays] = await Promise.all([
    prisma.attendanceSettings.findUnique({ where: { id: "singleton" } }),
    prisma.holiday.findMany(),
  ]);
  const weeklyOff = parseWeeklyOffDays(attendance?.weeklyOffDays ?? FALLBACK_WEEKLY_OFF_DAYS);
  const spans = holidays.map((h) => ({ from: dayStr(h.from), to: dayStr(h.to) }));
  return (day) => dayKind(day, weeklyOff, spans);
}

/**
 * Days recorded absent without an approved leave, the way the balance reads them: only from the day absences are
 * tracked (before it, a missing record said nothing about being absent, and nothing was charged for it).
 */
export function trackedAbsentDays(rows: { status: string; date: string }[]): string[] {
  return rows.filter((r) => r.status === "absent" && r.date >= ABSENCE_TRACKING_FROM).map((r) => r.date);
}

/** One employee's leaves and tracked absences in the shape leave-balance.ts reads, from the database. */
export async function loadBalanceInputs(employeeId: string, year: number): Promise<{ leaves: BalanceLeave[]; absentDays: string[] }> {
  const [leaves, absences] = await Promise.all([
    prisma.leave.findMany({ where: { employeeId }, select: { type: true, status: true, from: true, to: true } }),
    prisma.dailyAttendance.findMany({
      where: { employeeId, status: "absent", date: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T00:00:00.000Z`) } },
      select: { status: true, date: true },
    }),
  ]);
  return {
    leaves: leaves.map((l) => ({ type: l.type, status: l.status, from: dayStr(l.from), to: dayStr(l.to) })),
    absentDays: trackedAbsentDays(absences.map((a) => ({ status: a.status, date: dayStr(a.date) }))),
  };
}
