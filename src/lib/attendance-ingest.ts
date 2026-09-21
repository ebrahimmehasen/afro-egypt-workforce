import { prisma } from "@/lib/prisma";
import { recalculateDailyAttendance } from "@/lib/attendance-service";
import { PUNCH_WINDOW_MS, getShiftWindow, shiftDaysForPunch } from "@/lib/attendance-engine";
import { PayContext, PayEmployee, effectiveShift, loadPayContext } from "@/lib/pay-context";
import { localDay } from "@/lib/today";
import { Shift } from "@/lib/types";

/** The stretch of time whose punches count towards one shift day — the same one recalculation reads. */
export function punchWindow(day: string, shift: Shift): { gte: Date; lte: Date } {
  const { scheduledStart, scheduledEnd } = getShiftWindow(day, shift);
  return { gte: new Date(scheduledStart.getTime() - PUNCH_WINDOW_MS), lte: new Date(scheduledEnd.getTime() + PUNCH_WINDOW_MS) };
}

/** The shift day(s) a punch belongs to and that day's hours, by the employee's own schedule. */
export function punchDays(ctx: PayContext, employee: PayEmployee, at: Date): { days: string[]; shift: Shift } {
  const shift = effectiveShift(ctx, employee, localDay(at));
  return { days: shiftDaysForPunch(at, shift), shift };
}

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
  });
  if (!employee) return { imported: false, reason: "unlinked" };

  const existing = await prisma.attendanceLog.findFirst({
    where: { employeeId: employee.id, timestamp: recordTime },
    select: { id: true },
  });
  if (existing) return { imported: false, reason: "duplicate" };

  const ctx = await loadPayContext();
  const { days, shift } = punchDays(ctx, employee, recordTime);
  const priorInShift = await prisma.attendanceLog.count({
    where: { employeeId: employee.id, timestamp: { ...punchWindow(days[0], shift), lt: recordTime } },
  });

  await prisma.attendanceLog.create({
    data: {
      employeeId: employee.id,
      deviceUserId,
      timestamp: recordTime,
      punchType: priorInShift === 0 ? "in" : "out",
      source: "biometric",
    },
  });

  for (const day of days) await recalculateDailyAttendance(employee.id, day, ctx);
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
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (rows.length === 0 || !employee) return { deleted: 0, daysRecalculated: 0 };

  const ctx = await loadPayContext();
  const dates = new Set(rows.flatMap((r) => punchDays(ctx, employee, r.timestamp).days));

  const { count } = await prisma.attendanceLog.deleteMany({
    where: { employeeId, deviceUserId, source: "biometric" },
  });

  for (const date of dates) {
    await recalculateDailyAttendance(employeeId, date, ctx);
  }

  return { deleted: count, daysRecalculated: dates.size };
}
