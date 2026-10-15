import { prisma } from "@/lib/prisma";
import type { ScheduleRow } from "@/components/settings/pay-settings";

/**
 * The work schedules ("مواعيد العمل") as both pages list them — the settings page and /shifts read the same
 * rows, so one added or changed on either shows on both. Each with the employees on it (removed ones not counted).
 */
export async function loadScheduleRows(): Promise<ScheduleRow[]> {
  const schedules = await prisma.workSchedule.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { employees: { where: { deletedAt: null } } } } },
  });
  return schedules.map((s) => ({
    id: s.id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    overtimeStart: s.overtimeStart,
    active: s.active,
    deletedAt: s.deletedAt ? s.deletedAt.toISOString() : null,
    employees: s._count.employees,
  }));
}
