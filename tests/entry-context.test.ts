import { describe, expect, it } from "vitest";
import { buildEntryContext } from "@/lib/entry-context";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { PayContext } from "@/lib/pay-context";

const employee = {
  id: "e1",
  employeeNumber: "PROD-001",
  name: "سامي",
  departmentId: "d1",
  jobTitle: "نجار",
  shiftId: "s1",
  salaryType: "monthly" as const,
  basicSalary: 6000,
  payTypeId: "pt1",
};
const attendanceDay = {
  employeeId: "e1",
  date: "2026-09-22",
  status: "late",
  actualIn: "2026-09-22T08:10:00.000Z",
  actualOut: "2026-09-22T18:00:00.000Z",
  deductibleLateMinutes: 10,
  workedMinutes: 590,
  scheduledStart: "2026-09-22T08:00:00.000Z",
  scheduledEnd: "2026-09-22T18:00:00.000Z",
};
const db = {
  employees: [employee],
  departments: [{ id: "d1", name: "الإنتاج" }],
  dailyAttendance: [attendanceDay],
} as unknown as Parameters<typeof buildEntryContext>[1];
const payContext = { payTypes: [{ ...FALLBACK_PAY_TYPES.monthly, id: "pt1", name: "موظف شهري", active: true, deletedAt: null }] } as PayContext;

describe("buildEntryContext", () => {
  it("gives a row its employee, department, pay type and that day's attendance", () => {
    const ctx = buildEntryContext([{ id: "ded1", employeeId: "e1", date: "2026-09-22" }], db, payContext);
    expect(ctx.ded1).toMatchObject({
      department: "الإنتاج",
      payType: "موظف شهري",
      day: { status: "late", lateMinutes: 10, workedMinutes: 590 },
    });
    expect(ctx.ded1.employee?.name).toBe("سامي");
  });

  it("leaves the day out when the entry's date has no attendance record", () => {
    const ctx = buildEntryContext([{ id: "ded2", employeeId: "e1", date: "2026-09-01" }], db, payContext);
    expect(ctx.ded2.day).toBeUndefined();
    expect(ctx.ded2.employee?.name).toBe("سامي");
  });

  it("survives a row whose employee is gone", () => {
    const ctx = buildEntryContext([{ id: "x", employeeId: "missing", date: "2026-09-22" }], db, payContext);
    expect(ctx.x).toEqual({ employee: undefined, department: undefined, payType: undefined, day: undefined });
  });
});
