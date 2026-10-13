import { describe, expect, it } from "vitest";
import { PayTypeRules } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { systemEntriesFor } from "@/lib/attendance-deductions";
import { leaveCharges, type DayKindOf } from "@/lib/leave-balance";

/**
 * What a day of absence costs in pay now that the annual-leave balance pays for absences first: nothing while
 * the balance covers it, the pay type's absence table (1 day with notice, 2 without) once it doesn't, and a
 * Friday inside a leave is charged like the leave's other days. Salary 6000 / 30 = 200 a day.
 */
const monthly: PayTypeRules = { ...FALLBACK_PAY_TYPES.monthly, id: "pt-monthly", hoursPerDay: 10 };
const regular = { start: "08:00", end: "16:30", overtimeStart: "16:30" };
const employee = { id: "e1", shiftId: "s1", salaryType: "monthly" as const, basicSalary: 6000 };
const at = (day: string, time: string) => new Date(`${day}T${time}`);
const day = (date: string, status: string) => ({ employeeId: "e1", date, status, actualIn: null, actualOut: null, scheduledStart: at(date, "08:00:00") });
// 22 Oct 2026 is a Thursday, 23 a Friday (weekly day off), 24 a Saturday
const THU = "2026-10-22";
const FRI = "2026-10-23";
const SAT = "2026-10-24";
const kindOf: DayKindOf = (d) => (new Date(`${d}T00:00:00Z`).getUTCDay() === 5 ? "weekly_off" : "workday");
// an approved annual leave asked well ahead (a week before) — "permitted" by the table
const leave = { type: "annual", createdAt: new Date("2026-10-10T08:00:00") };

describe("an absence the balance covers costs no pay", () => {
  it("an approved annual-leave day covered by the balance posts no deduction", () => {
    const e = systemEntriesFor(day(THU, "leave"), employee, monthly, regular, "workday", leave, { coveredByBalance: true, sandwiched: false });
    expect(e.deductions).toEqual([]);
    expect(e.additions).toEqual([]);
  });

  it("an absent day without any leave, covered by the balance, posts no deduction either", () => {
    const e = systemEntriesFor(day(THU, "absent"), employee, monthly, regular, "workday", null, { coveredByBalance: true, sandwiched: false });
    expect(e.deductions).toEqual([]);
  });
});

describe("once the balance can't cover it, the absence table applies", () => {
  it("an approved leave asked with notice costs 1 day of pay", () => {
    const e = systemEntriesFor(day(THU, "leave"), employee, monthly, regular, "workday", leave, { coveredByBalance: false, sandwiched: false });
    expect(e.deductions).toMatchObject([{ type: "absence", amount: 200 }]);
    expect(e.deductions[0].reason).toContain("مفيش رصيد إجازة");
  });

  it("an absence with no leave costs 2 days of pay", () => {
    const e = systemEntriesFor(day(THU, "absent"), employee, monthly, regular, "workday", null, { coveredByBalance: false, sandwiched: false });
    expect(e.deductions).toMatchObject([{ type: "absence", amount: 400 }]);
  });

  it("without any balance information the day is charged exactly as before", () => {
    const e = systemEntriesFor(day(THU, "leave"), employee, monthly, regular, "workday", leave);
    expect(e.deductions).toMatchObject([{ type: "absence", amount: 200 }]);
  });
});

describe("a Friday inside a leave", () => {
  it("Thursday to Saturday with no balance is 3 days charged to pay: the Friday too", () => {
    const charges = leaveCharges({
      hireDate: "2026-06-01", // under 6 months: no balance
      leaves: [{ type: "annual", status: "approved", from: THU, to: SAT }],
      absentDays: [],
      year: 2026,
      upTo: "2026-10-31",
      kindOf,
    });
    const total = [THU, FRI, SAT]
      .map((d) => systemEntriesFor(day(d, "leave"), employee, monthly, regular, kindOf(d), leave, charges.get(d)))
      .flatMap((e) => e.deductions)
      .reduce((sum, d) => sum + d.amount, 0);
    expect(total).toBe(3 * 200);
  });

  it("the same leave with enough balance costs nothing — the 3 days come off the balance", () => {
    const charges = leaveCharges({
      hireDate: "2024-01-01",
      leaves: [{ type: "annual", status: "approved", from: THU, to: SAT }],
      absentDays: [],
      year: 2026,
      upTo: "2026-10-31",
      kindOf,
    });
    const deductions = [THU, FRI, SAT].flatMap(
      (d) => systemEntriesFor(day(d, "leave"), employee, monthly, regular, kindOf(d), leave, charges.get(d)).deductions,
    );
    expect(deductions).toEqual([]);
    expect([...charges.values()].filter((c) => c.coveredByBalance)).toHaveLength(3);
  });

  it("a Friday that is not inside a leave is never charged", () => {
    const e = systemEntriesFor(day(FRI, "leave"), employee, monthly, regular, "weekly_off", leave, undefined);
    expect(e.deductions).toEqual([]);
  });
});
