import { describe, expect, it } from "vitest";
import { PayTypeRules, computeDayPay } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { systemEntriesFor } from "@/lib/attendance-deductions";

/**
 * Overtime is for salaried (monthly) employees only. A daily worker gets no overtime for staying past the
 * overtime start — whatever their "له إضافي" switch says. Their work on the weekly day off or a public holiday
 * is still paid by the hour (that is how those days are paid at all), and so is Thursday's extra time.
 */
const common = { hoursPerDay: 10, graceMinutes: 0, overtimeMultiplier: 1.5, overtimeMinimumMinutes: 60, overtimeStepMinutes: 30, fridayMultiplier: 2, holidayMultiplier: 2 };
const monthly: PayTypeRules = { ...FALLBACK_PAY_TYPES.monthly, ...common, id: "pt-monthly", thursdayRuleEnabled: false };
const daily: PayTypeRules = { ...FALLBACK_PAY_TYPES.daily, ...common, id: "pt-daily", thursdayRuleEnabled: true, thursdayWorkEnd: "16:30", thursdayExtraMultiplier: 1 };
const schedule = { start: "08:00", end: "16:30", overtimeStart: "16:30" };
const pay = { basicSalary: 6000, dailyRate: 230, overtimeEligible: true };
// 2026-10-12 is a Monday, 2026-10-15 a Thursday, 2026-10-16 a Friday
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);
const day = (rules: PayTypeRules, date: string, outTime: string, kind: "workday" | "weekly_off" | "holiday" = "workday") =>
  computeDayPay({ date, kind, schedule, rules, pay, actualIn: at(date, "08:00"), actualOut: at(date, outTime), hasPermission: false });
const kinds = (p: ReturnType<typeof computeDayPay>) => p.items.map((i) => i.kind);

describe("overtime: salaried employees only", () => {
  it("a salaried employee staying 2 hours past the overtime start gets overtime", () => {
    const p = day(monthly, "2026-10-12", "18:30");
    expect(p.items).toEqual([expect.objectContaining({ kind: "overtime", minutes: 120, multiplier: 1.5 })]);
  });

  it("a daily worker staying the same 2 hours gets no overtime", () => {
    expect(kinds(day(daily, "2026-10-12", "18:30"))).toEqual([]);
  });

  it("…and the system posts no overtime entry for that day", () => {
    const { additions } = systemEntriesFor(
      { employeeId: "d", date: "2026-10-12", status: "present", actualIn: at("2026-10-12", "08:00"), actualOut: at("2026-10-12", "18:30"), scheduledStart: at("2026-10-12", "08:00") },
      { id: "d", shiftId: "s", salaryType: "daily", basicSalary: 6000, dailyRate: 230, overtimeEligible: true },
      daily,
      schedule,
      "workday",
      null,
    );
    expect(additions).toEqual([]);
  });

  it("a daily worker's Friday and public-holiday work is still paid by the hour", () => {
    expect(kinds(day(daily, "2026-10-16", "13:00", "weekly_off"))).toEqual(["friday"]);
    expect(kinds(day(daily, "2026-10-12", "13:00", "holiday"))).toEqual(["holiday"]);
  });

  it("a daily worker's Thursday time after the short day is still paid, but nothing past the overtime start", () => {
    // Thursday ends at 16:30 for the daily type: 16:30 → 16:30 overtime start leaves no Thursday window here,
    // so use a later overtime start to open one
    const p = computeDayPay({ date: "2026-10-15", kind: "workday", schedule: { start: "08:00", end: "18:30", overtimeStart: "18:30" }, rules: daily, pay, actualIn: at("2026-10-15", "08:00"), actualOut: at("2026-10-15", "20:30"), hasPermission: false });
    expect(kinds(p)).toEqual(["thursday_extra"]);
  });

  it("lateness and leaving early are charged to both as before", () => {
    const late = (rules: PayTypeRules) => computeDayPay({ date: "2026-10-12", kind: "workday", schedule, rules, pay, actualIn: at("2026-10-12", "08:30"), actualOut: at("2026-10-12", "15:30"), hasPermission: false });
    expect(kinds(late(monthly))).toEqual(["late", "unauthorized_exit"]);
    expect(kinds(late(daily))).toEqual(["late", "unauthorized_exit"]);
  });
});
