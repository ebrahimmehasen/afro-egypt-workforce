import { describe, expect, it } from "vitest";
import {
  computeDailyAttendance,
  computeFromActuals,
  getShiftWindow,
} from "@/lib/attendance-engine";
import { AttendanceLog, Shift } from "@/lib/types";

const MORNING: Shift = {
  id: "SHIFT-MORNING",
  name: "الوردية الصباحية",
  startTime: "08:00",
  endTime: "16:00",
  gracePeriodMinutes: 10,
  workDays: [0, 1, 2, 3, 4, 5],
  allowOvertime: true,
};

const NIGHT: Shift = {
  id: "SHIFT-NIGHT",
  name: "الوردية الليلية",
  startTime: "22:00",
  endTime: "06:00",
  gracePeriodMinutes: 10,
  workDays: [0, 1, 2, 3, 4, 5],
  allowOvertime: false,
};

const DATE = "2026-08-21";

function log(time: string, punchType: "in" | "out", date = DATE): AttendanceLog {
  return {
    id: `LOG-${time}`,
    employeeId: "EMP-1001",
    deviceId: "ZK-DEMO-01",
    timestamp: `${date}T${time}:00`,
    punchType,
    source: "simulated",
  };
}

function compute(logs: AttendanceLog[], shift = MORNING) {
  return computeDailyAttendance({
    employeeId: "EMP-1001",
    date: DATE,
    shift,
    logs,
    isOnApprovedLeave: false,
  });
}

describe("getShiftWindow", () => {
  it("keeps a day shift on the same calendar day", () => {
    const { scheduledStart, scheduledEnd } = getShiftWindow(DATE, MORNING);
    expect(scheduledStart.toISOString()).toBe(new Date("2026-08-21T08:00:00").toISOString());
    expect(scheduledEnd.toISOString()).toBe(new Date("2026-08-21T16:00:00").toISOString());
  });

  it("rolls the end of an overnight shift to the next day", () => {
    const { scheduledStart, scheduledEnd } = getShiftWindow(DATE, NIGHT);
    expect(scheduledStart.getDate()).toBe(21);
    expect(scheduledEnd.getDate()).toBe(22);
    expect(scheduledEnd.getHours()).toBe(6);
  });
});

describe("computeDailyAttendance", () => {
  it("marks a fully absent day (no punches)", () => {
    const r = compute([]);
    expect(r.status).toBe("absent");
    expect(r.actualIn).toBeNull();
    expect(r.workedMinutes).toBe(0);
  });

  it("marks present and on time within the grace period", () => {
    const r = compute([log("08:07", "in"), log("16:02", "out")]);
    expect(r.status).toBe("present");
    expect(r.lateMinutes).toBe(7);
    expect(r.deductibleLateMinutes).toBe(0);
    expect(r.workedMinutes).toBe(475);
  });

  it("marks late and only counts minutes beyond the grace period as deductible", () => {
    const r = compute([log("08:35", "in"), log("16:00", "out")]);
    expect(r.status).toBe("late");
    expect(r.lateMinutes).toBe(35);
    expect(r.deductibleLateMinutes).toBe(25);
  });

  it("marks early leave", () => {
    const r = compute([log("08:00", "in"), log("15:20", "out")]);
    expect(r.status).toBe("early_leave");
    expect(r.earlyLeaveMinutes).toBe(40);
  });

  it("marks a missing punch when only one punch exists (never auto-absent)", () => {
    const r = compute([log("08:00", "in")]);
    expect(r.status).toBe("missing_punch");
    expect(r.actualOut).toBeNull();
  });

  it("computes overtime beyond the scheduled shift length", () => {
    const r = compute([log("08:00", "in"), log("18:10", "out")]);
    expect(r.overtimeMinutes).toBe(130);
  });

  it("honours an approved leave regardless of punches", () => {
    const r = computeDailyAttendance({
      employeeId: "EMP-1004",
      date: DATE,
      shift: MORNING,
      logs: [],
      isOnApprovedLeave: true,
      leaveType: "leave",
    });
    expect(r.status).toBe("leave");
  });

  it("computes an overnight shift where check-out is on the next calendar day", () => {
    const r = compute(
      [log("22:00", "in", "2026-08-21"), log("06:00", "out", "2026-08-22")],
      NIGHT,
    );
    expect(r.status).toBe("present");
    expect(r.workedMinutes).toBe(480);
    expect(r.overtimeMinutes).toBe(0);
  });
});

describe("computeFromActuals (HR corrections share the same math)", () => {
  it("recomputes status from a corrected check-out", () => {
    const { scheduledStart, scheduledEnd } = getShiftWindow(DATE, MORNING);
    const r = computeFromActuals(
      scheduledStart,
      scheduledEnd,
      MORNING,
      new Date("2026-08-21T08:00:00"),
      new Date("2026-08-21T16:05:00"),
    );
    expect(r.status).toBe("present");
    expect(r.earlyLeaveMinutes).toBe(0);
  });
});
