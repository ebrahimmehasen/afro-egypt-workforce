import { AttendanceLog, AttendanceStatus, DailyAttendance, Shift } from "@/lib/types";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Builds the scheduled start/end ISO datetimes for a shift on a given date, handling overnight shifts. */
export function getShiftWindow(date: string, shift: Shift) {
  const start = new Date(`${date}T${shift.startTime}:00`);
  const end = new Date(`${date}T${shift.endTime}:00`);
  if (toMinutes(shift.endTime) <= toMinutes(shift.startTime)) {
    // overnight shift: end falls on the next day
    end.setDate(end.getDate() + 1);
  }
  return { scheduledStart: start, scheduledEnd: end };
}

export interface ComputeDailyAttendanceInput {
  employeeId: string;
  date: string;
  shift: Shift;
  logs: AttendanceLog[]; // all raw logs for this employee on this date (already filtered)
  isOnApprovedLeave: boolean;
  leaveType?: "mission" | "excused_absence" | "leave";
}

export interface ComputedAttendance {
  scheduledStart: Date;
  scheduledEnd: Date;
  actualIn: Date | null;
  actualOut: Date | null;
  lateMinutes: number;
  deductibleLateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
}

/**
 * Core attendance calculation. First punch of the day = IN, last punch = OUT.
 * Grace period distinguishes "actual lateness" from "deductible lateness" per spec §20.
 */
export function computeDailyAttendance(input: ComputeDailyAttendanceInput): ComputedAttendance {
  const { shift, logs, date, isOnApprovedLeave, leaveType } = input;
  const { scheduledStart, scheduledEnd } = getShiftWindow(date, shift);

  const sorted = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const actualIn = sorted.length > 0 ? new Date(sorted[0].timestamp) : null;
  const actualOut = sorted.length > 1 ? new Date(sorted[sorted.length - 1].timestamp) : null;

  if (isOnApprovedLeave) {
    const status: AttendanceStatus =
      leaveType === "mission" ? "mission" : leaveType === "excused_absence" ? "excused_absence" : "leave";
    return {
      scheduledStart,
      scheduledEnd,
      actualIn,
      actualOut,
      lateMinutes: 0,
      deductibleLateMinutes: 0,
      earlyLeaveMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      status,
    };
  }

  if (!actualIn) {
    return {
      scheduledStart,
      scheduledEnd,
      actualIn: null,
      actualOut: null,
      lateMinutes: 0,
      deductibleLateMinutes: 0,
      earlyLeaveMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      status: "absent",
    };
  }

  if (!actualOut) {
    // Only one punch recorded — HR must review, do not auto-mark absent (spec §23)
    const lateMinutes = Math.max(0, Math.round((actualIn.getTime() - scheduledStart.getTime()) / 60000));
    const deductibleLateMinutes = Math.max(0, lateMinutes - shift.gracePeriodMinutes);
    return {
      scheduledStart,
      scheduledEnd,
      actualIn,
      actualOut: null,
      lateMinutes,
      deductibleLateMinutes,
      earlyLeaveMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      status: "missing_punch",
    };
  }

  const lateMinutes = Math.max(0, Math.round((actualIn.getTime() - scheduledStart.getTime()) / 60000));
  const deductibleLateMinutes = Math.max(0, lateMinutes - shift.gracePeriodMinutes);
  const earlyLeaveMinutes = Math.max(0, Math.round((scheduledEnd.getTime() - actualOut.getTime()) / 60000));
  const workedMinutes = Math.max(0, Math.round((actualOut.getTime() - actualIn.getTime()) / 60000));
  const shiftDurationMinutes = Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000);
  const overtimeMinutes = Math.max(0, workedMinutes - shiftDurationMinutes);

  let status: AttendanceStatus = "present";
  if (deductibleLateMinutes > 0) status = "late";
  else if (earlyLeaveMinutes > 0) status = "early_leave";

  return {
    scheduledStart,
    scheduledEnd,
    actualIn,
    actualOut,
    lateMinutes,
    deductibleLateMinutes,
    earlyLeaveMinutes,
    workedMinutes,
    overtimeMinutes,
    status,
  };
}

/**
 * Recomputes late/early/worked/overtime/status from a given actualIn/actualOut pair.
 * Shared by the raw-punch path and manual HR corrections (spec §24) so both stay consistent.
 */
export function computeFromActuals(
  scheduledStart: Date,
  scheduledEnd: Date,
  shift: Shift,
  actualIn: Date | null,
  actualOut: Date | null,
): ComputedAttendance {
  if (!actualIn) {
    return {
      scheduledStart,
      scheduledEnd,
      actualIn: null,
      actualOut: null,
      lateMinutes: 0,
      deductibleLateMinutes: 0,
      earlyLeaveMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      status: "absent",
    };
  }

  const lateMinutes = Math.max(0, Math.round((actualIn.getTime() - scheduledStart.getTime()) / 60000));
  const deductibleLateMinutes = Math.max(0, lateMinutes - shift.gracePeriodMinutes);

  if (!actualOut) {
    return {
      scheduledStart,
      scheduledEnd,
      actualIn,
      actualOut: null,
      lateMinutes,
      deductibleLateMinutes,
      earlyLeaveMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      status: "missing_punch",
    };
  }

  const earlyLeaveMinutes = Math.max(0, Math.round((scheduledEnd.getTime() - actualOut.getTime()) / 60000));
  const workedMinutes = Math.max(0, Math.round((actualOut.getTime() - actualIn.getTime()) / 60000));
  const shiftDurationMinutes = Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000);
  const overtimeMinutes = Math.max(0, workedMinutes - shiftDurationMinutes);

  let status: AttendanceStatus = "present";
  if (deductibleLateMinutes > 0) status = "late";
  else if (earlyLeaveMinutes > 0) status = "early_leave";

  return {
    scheduledStart,
    scheduledEnd,
    actualIn,
    actualOut,
    lateMinutes,
    deductibleLateMinutes,
    earlyLeaveMinutes,
    workedMinutes,
    overtimeMinutes,
    status,
  };
}

/**
 * Groups of AttendanceStatus that belong together when a KPI (e.g. dashboard's
 * "present today") counts more than one literal status. Shared between the KPI
 * selectors and any status filter UI so a filtered list always matches the
 * number shown on the KPI that linked to it.
 */
export const ATTENDANCE_STATUS_GROUPS: Partial<Record<AttendanceStatus | "all", AttendanceStatus[]>> = {
  present: ["present", "late", "early_leave"],
  late: ["late"],
  absent: ["absent"],
  leave: ["leave", "mission", "excused_absence"],
  early_leave: ["early_leave"],
  missing_punch: ["missing_punch"],
};

/** Does this attendance record match a status filter value, honoring the KPI groupings above? */
export function matchesAttendanceStatusFilter(recordStatus: AttendanceStatus, filter: string): boolean {
  if (filter === "all") return true;
  const group = ATTENDANCE_STATUS_GROUPS[filter as AttendanceStatus];
  if (group) return group.includes(recordStatus);
  return recordStatus === filter;
}

export function attendanceSummary(records: DailyAttendance[]) {
  return {
    present: records.filter((r) => r.status === "present").length,
    late: records.filter((r) => r.status === "late").length,
    absent: records.filter((r) => r.status === "absent").length,
    leave: records.filter((r) => ["leave", "mission", "excused_absence"].includes(r.status)).length,
    missingPunch: records.filter((r) => r.status === "missing_punch").length,
    earlyLeave: records.filter((r) => r.status === "early_leave").length,
  };
}
