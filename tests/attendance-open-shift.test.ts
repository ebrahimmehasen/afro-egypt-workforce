import { describe, expect, it } from "vitest";
import { OPEN_SHIFT_GRACE_MS, withOpenShift } from "@/lib/attendance-engine";
import { DailyAttendance } from "@/lib/types";

// a morning shift, 08:00-16:00 Cairo = 05:00-13:00 UTC, with one check-in and no check-out yet
const checkedIn: DailyAttendance = {
  id: "a1",
  employeeId: "e1",
  date: "2026-09-21",
  shiftId: "s1",
  scheduledStart: "2026-09-21T05:00:00.000Z",
  scheduledEnd: "2026-09-21T13:00:00.000Z",
  actualIn: "2026-09-21T04:40:00.000Z",
  actualOut: null,
  lateMinutes: 0,
  deductibleLateMinutes: 0,
  earlyLeaveMinutes: 0,
  workedMinutes: 0,
  overtimeMinutes: 0,
  status: "missing_punch",
};
const at = (iso: string) => new Date(iso);

describe("withOpenShift", () => {
  it("counts someone who checked in and whose shift is still running as present", () => {
    expect(withOpenShift(checkedIn, at("2026-09-21T09:00:00Z")).status).toBe("present");
  });

  it("keeps lateness: a late check-in during the shift reads as late", () => {
    const late = { ...checkedIn, actualIn: "2026-09-21T05:42:00.000Z", lateMinutes: 42, deductibleLateMinutes: 32 };
    expect(withOpenShift(late, at("2026-09-21T09:00:00Z")).status).toBe("late");
  });

  it("still counts them present while they may be on overtime just after the shift", () => {
    expect(withOpenShift(checkedIn, at("2026-09-21T14:00:00Z")).status).toBe("present");
  });

  it("goes back to a missing punch once the shift and its grace are over", () => {
    const after = new Date(new Date(checkedIn.scheduledEnd).getTime() + OPEN_SHIFT_GRACE_MS);
    expect(withOpenShift(checkedIn, after).status).toBe("missing_punch");
    expect(withOpenShift(checkedIn, at("2026-09-22T09:00:00Z")).status).toBe("missing_punch");
  });

  it("leaves every other day alone: complete days, absences, leave, and HR corrections", () => {
    const now = at("2026-09-21T09:00:00Z");
    const complete = { ...checkedIn, actualOut: "2026-09-21T13:05:00.000Z", status: "present" as const };
    expect(withOpenShift(complete, now)).toBe(complete);
    const corrected = { ...checkedIn, correctedAt: "2026-09-21T08:00:00.000Z", correctionReason: "x" };
    expect(withOpenShift(corrected, now).status).toBe("missing_punch");
    const leave = { ...checkedIn, status: "leave" as const };
    expect(withOpenShift(leave, now).status).toBe("leave");
  });
});
