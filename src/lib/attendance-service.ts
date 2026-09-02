import { computeDailyAttendance } from "@/lib/attendance-engine";
import { getDb } from "@/lib/data";
import { DailyAttendance } from "@/lib/types";

/** Recomputes and upserts the DailyAttendance row for one employee/date from current raw logs + leaves. */
export function recalculateDailyAttendance(employeeId: string, date: string): DailyAttendance | null {
  const db = getDb();
  const employee = db.employees.find((e) => e.id === employeeId);
  if (!employee) return null;
  const shift = db.shifts.find((s) => s.id === employee.shiftId);
  if (!shift) return null;

  const logs = db.attendanceLogs.filter((l) => l.employeeId === employeeId && l.timestamp.startsWith(date));

  const leave = db.leaves.find(
    (l) => l.employeeId === employeeId && l.status === "approved" && l.from <= date && date <= l.to,
  );

  const computed = computeDailyAttendance({
    employeeId,
    date,
    shift,
    logs,
    isOnApprovedLeave: Boolean(leave),
    leaveType:
      leave?.type === "mission" ? "mission" : leave?.type === "excused_absence" ? "excused_absence" : "leave",
  });

  const existingIdx = db.dailyAttendance.findIndex((a) => a.employeeId === employeeId && a.date === date);

  const record: DailyAttendance = {
    id: existingIdx >= 0 ? db.dailyAttendance[existingIdx].id : `DA-${db.dailyAttendance.length + 1}`,
    employeeId,
    date,
    shiftId: shift.id,
    scheduledStart: computed.scheduledStart.toISOString(),
    scheduledEnd: computed.scheduledEnd.toISOString(),
    actualIn: computed.actualIn?.toISOString() ?? null,
    actualOut: computed.actualOut?.toISOString() ?? null,
    lateMinutes: computed.lateMinutes,
    deductibleLateMinutes: computed.deductibleLateMinutes,
    earlyLeaveMinutes: computed.earlyLeaveMinutes,
    workedMinutes: computed.workedMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status: computed.status,
    ...(existingIdx >= 0 && db.dailyAttendance[existingIdx].correctionReason
      ? {
          correctionReason: db.dailyAttendance[existingIdx].correctionReason,
          correctedBy: db.dailyAttendance[existingIdx].correctedBy,
          correctedAt: db.dailyAttendance[existingIdx].correctedAt,
        }
      : {}),
  };

  if (existingIdx >= 0) db.dailyAttendance[existingIdx] = record;
  else db.dailyAttendance.push(record);

  return record;
}
