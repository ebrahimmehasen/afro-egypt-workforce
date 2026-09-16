import { prisma } from "@/lib/prisma";
import { recalculateDailyAttendance } from "@/lib/attendance-service";

/**
 * Pure DB-side half of attendance ingestion — no device I/O here, so both
 * the poll-based sync (attendance-sync.ts) and the real-time listener
 * (attendance-realtime.ts) share this instead of duplicating the
 * dedup/in-out-inference/recalculate logic.
 */

export interface IngestOutcome {
  imported: boolean;
  reason?: "unlinked" | "duplicate";
}

/** Looks up the employee, dedupes, infers in/out, writes the log row, and
 * recalculates that day's attendance. Safe to call more than once for the
 * same punch (e.g. a punch seen by both the real-time listener and a
 * catch-up poll that overlaps it). */
export async function ingestOneRecord(deviceUserId: string, recordTime: Date): Promise<IngestOutcome> {
  const employee = await prisma.employee.findFirst({
    where: { biometricDeviceUserId: deviceUserId, deletedAt: null },
    select: { id: true },
  });
  if (!employee) return { imported: false, reason: "unlinked" };

  const existing = await prisma.attendanceLog.findFirst({
    where: { employeeId: employee.id, timestamp: recordTime },
    select: { id: true },
  });
  if (existing) return { imported: false, reason: "duplicate" };

  const dateStr = recordTime.toISOString().slice(0, 10);
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const priorToday = await prisma.attendanceLog.count({
    where: { employeeId: employee.id, timestamp: { gte: dayStart, lt: dayEnd } },
  });

  await prisma.attendanceLog.create({
    data: {
      employeeId: employee.id,
      deviceUserId,
      timestamp: recordTime,
      punchType: priorToday === 0 ? "in" : "out",
      source: "biometric",
    },
  });

  await recalculateDailyAttendance(employee.id, dateStr);
  return { imported: true };
}

/**
 * Undoes what ingestOneRecord built up for one employee/device-user pair -
 * used when a link is removed on /biometric-device, since those punches
 * were only ever attributable to this employee because of that link. Only
 * touches source: "biometric" rows (a manual HR correction lives on
 * DailyAttendance.correctionReason, not as an AttendanceLog row, so there's
 * nothing here that could delete one), and recomputes every day it
 * affected so DailyAttendance doesn't keep showing stale "present" rows
 * for punches that no longer exist for this employee.
 */
export async function removeDeviceUserAttendance(employeeId: string, deviceUserId: string): Promise<{ deleted: number; daysRecalculated: number }> {
  const rows = await prisma.attendanceLog.findMany({
    where: { employeeId, deviceUserId, source: "biometric" },
    select: { timestamp: true },
  });
  if (rows.length === 0) return { deleted: 0, daysRecalculated: 0 };

  const dates = new Set(rows.map((r) => r.timestamp.toISOString().slice(0, 10)));

  const { count } = await prisma.attendanceLog.deleteMany({
    where: { employeeId, deviceUserId, source: "biometric" },
  });

  for (const date of dates) {
    await recalculateDailyAttendance(employeeId, date);
  }

  return { deleted: count, daysRecalculated: dates.size };
}
