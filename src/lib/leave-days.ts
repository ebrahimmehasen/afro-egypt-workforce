import { prisma } from "@/lib/prisma";
import { dayKind, parseWeeklyOffDays } from "@/lib/pay-engine";
import { FALLBACK_WEEKLY_OFF_DAYS } from "@/lib/pay-defaults";
import { dayStr } from "@/lib/serialize";
import type { IsOffDay } from "@/lib/leave-balance";

/**
 * Reads the weekly day off (Settings → attendance) and the public holidays once, and returns the test the leave
 * balance uses to leave those days out of a leave's length. The same two sources the pay rules use, so a day that
 * counts as a day off for pay is also not charged to an annual leave.
 */
export async function loadOffDayRule(): Promise<IsOffDay> {
  const [attendance, holidays] = await Promise.all([
    prisma.attendanceSettings.findUnique({ where: { id: "singleton" } }),
    prisma.holiday.findMany(),
  ]);
  const weeklyOff = parseWeeklyOffDays(attendance?.weeklyOffDays ?? FALLBACK_WEEKLY_OFF_DAYS);
  const spans = holidays.map((h) => ({ from: dayStr(h.from), to: dayStr(h.to) }));
  return (day) => dayKind(day, weeklyOff, spans) !== "workday";
}
