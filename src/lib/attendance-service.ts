import { computeDailyAttendance, getShiftWindow } from "@/lib/attendance-engine";
import { prisma } from "@/lib/prisma";
import { toDailyAttendance } from "@/lib/serialize";
import { DailyAttendance } from "@/lib/types";
import type { Shift } from "@/lib/types";

/**
 * Recomputes and upserts the DailyAttendance row for one employee/date from the
 * current raw logs + approved leave. Raw logs are gathered by the shift's actual
 * scheduled window (which may cross midnight), not by calendar-day string match.
 */
export async function recalculateDailyAttendance(
  employeeId: string,
  date: string,
): Promise<DailyAttendance | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;
  const shiftRow = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
  if (!shiftRow) return null;

  const shift: Shift = {
    id: shiftRow.id,
    name: shiftRow.name,
    startTime: shiftRow.startTime,
    endTime: shiftRow.endTime,
    gracePeriodMinutes: shiftRow.gracePeriodMinutes,
    workDays: (shiftRow.workDays as number[]) ?? [],
    allowOvertime: shiftRow.allowOvertime,
  };

  const { scheduledStart, scheduledEnd } = getShiftWindow(date, shift);
  // widen the window a little so early / very-late punches are still attributed to this shift
  const windowStart = new Date(scheduledStart.getTime() - 6 * 60 * 60 * 1000);
  const windowEnd = new Date(scheduledEnd.getTime() + 6 * 60 * 60 * 1000);

  const rawLogs = await prisma.attendanceLog.findMany({
    where: { employeeId, timestamp: { gte: windowStart, lte: windowEnd } },
    orderBy: { timestamp: "asc" },
  });

  const dateOnly = new Date(`${date}T00:00:00.000Z`);
  const leave = await prisma.leave.findFirst({
    where: {
      employeeId,
      status: "approved",
      from: { lte: dateOnly },
      to: { gte: dateOnly },
    },
  });

  const computed = computeDailyAttendance({
    employeeId,
    date,
    shift,
    logs: rawLogs.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      deviceId: l.deviceId ?? "",
      timestamp: l.timestamp.toISOString(),
      punchType: l.punchType,
      source: l.source === "biometric" ? "simulated" : l.source,
    })),
    isOnApprovedLeave: Boolean(leave),
    leaveType:
      leave?.type === "mission"
        ? "mission"
        : leave?.type === "excused_absence"
          ? "excused_absence"
          : "leave",
  });

  const existing = await prisma.dailyAttendance.findUnique({
    where: { employeeId_date: { employeeId, date: dateOnly } },
  });

  const data = {
    shiftId: shift.id,
    scheduledStart: computed.scheduledStart,
    scheduledEnd: computed.scheduledEnd,
    actualIn: computed.actualIn,
    actualOut: computed.actualOut,
    lateMinutes: computed.lateMinutes,
    deductibleLateMinutes: computed.deductibleLateMinutes,
    earlyLeaveMinutes: computed.earlyLeaveMinutes,
    workedMinutes: computed.workedMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status: computed.status,
  };

  const row = await prisma.dailyAttendance.upsert({
    where: { employeeId_date: { employeeId, date: dateOnly } },
    create: { employeeId, date: dateOnly, ...data },
    // a manual HR correction wins over an automatic recompute — keep its fields
    update: existing?.correctionReason ? {} : data,
  });

  return toDailyAttendance(row);
}
