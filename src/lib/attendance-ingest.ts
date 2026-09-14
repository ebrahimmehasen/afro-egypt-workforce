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
