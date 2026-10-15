import { describe, expect, it } from "vitest";
import { PayTypeRules, computeDayPay, dayRate, hourlyRate } from "@/lib/pay-engine";
import { kindOf as kindOfCtx } from "@/lib/pay-context";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { dailyPaidDays } from "@/lib/pay-rules";
import { systemEntriesFor } from "@/lib/attendance-deductions";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { chargedLeaveDays } from "@/lib/leave-balance";
import type { Employee } from "@/lib/types";

/**
 * Public holidays (Holiday) by pay basis — the rule as the engines already apply it:
 *  - salaried: the holiday is on the factory — full salary, nothing taken off for it;
 *  - daily: the holiday is unpaid — not one of the paid days (dailyPaidDays), no day's pay for it;
 *  - a daily worker who works the holiday is paid by the hour at the pay type's holiday multiplier.
 * The basis is the pay type's (rules.basis → salaryType), as calculatePeriodRecords passes it.
 */

// Friday is the weekly day off. Eid: Mon 19 – Wed 21 Oct 2026. Fri 30 Oct 2026 is also a public holiday.
const ctx = { weeklyOffDays: [5], holidays: [{ from: "2026-10-19", to: "2026-10-21" }, { from: "2026-10-30", to: "2026-10-30" }] };
const noHolidays = { weeklyOffDays: [5], holidays: [] };
const kindOf = (d: string) => kindOfCtx(ctx, d);
const EID = ["2026-10-19", "2026-10-20", "2026-10-21"];
const FRIDAY_HOLIDAY = "2026-10-30";

const monthlyRules: PayTypeRules = { ...FALLBACK_PAY_TYPES.monthly, id: "pt-monthly", hoursPerDay: 10, holidayMultiplier: 2, fridayMultiplier: 2 };
const dailyRules: PayTypeRules = { ...FALLBACK_PAY_TYPES.daily, id: "pt-daily", hoursPerDay: 10, holidayMultiplier: 2, fridayMultiplier: 2 };
const regular = { start: "08:00", end: "16:30", overtimeStart: "16:30" };
const at = (day: string, time: string) => new Date(`${day}T${time}`);

const monthlyEmp = { id: "m", shiftId: "s", salaryType: "monthly" as const, basicSalary: 6000 };
const dailyEmp = { id: "d", shiftId: "s", salaryType: "daily" as const, basicSalary: 5200, dailyRate: 200 };

/** Every calendar day of 12 Oct – 31 Oct 2026 */
const calendar = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10));

/** The attendance a month leaves: present on each working day, nothing on the days off — as the engine records it. */
const month = (k: (d: string) => string) => calendar.filter((d) => k(d) === "workday").map((date) => ({ date, status: "present" }));

const record = (salaryType: "monthly" | "daily", paidDays: number, dayRateValue: number) =>
  calculatePayrollRecord("P", {
    employee: { id: "x", employeeNumber: "X", name: "x", departmentId: "D", jobTitle: "x", hireDate: "2024-01-01", shiftId: "s", salaryType, basicSalary: salaryType === "monthly" ? 6000 : 5200, dailyWorkingHours: 10, allowances: 0, status: "active" } as Employee,
    allowancesTotal: 0,
    approvedOvertimeAmount: 0,
    incentives: 0,
    bonuses: 0,
    dayRate: dayRateValue,
    paidDays,
    deductions: [],
  });

/** What the system would post for each day of the calendar: no punches on the holidays, a stray "absent" too. */
const postedFor = (emp: typeof monthlyEmp | typeof dailyEmp, rules: PayTypeRules, status: string) =>
  [...EID, FRIDAY_HOLIDAY].flatMap((date) =>
    systemEntriesFor(
      { employeeId: emp.id, date, status, actualIn: null, actualOut: null, scheduledStart: at(date, "08:00:00") },
      emp,
      rules,
      regular,
      kindOf(date),
      null,
    ).deductions,
  );

describe("the kind of day", () => {
  it("each Eid day is a holiday, and a holiday on a Friday is a holiday — one kind, never both", () => {
    expect(EID.map(kindOf)).toEqual(["holiday", "holiday", "holiday"]);
    expect(kindOf(FRIDAY_HOLIDAY)).toBe("holiday");
    expect(kindOf("2026-10-23")).toBe("weekly_off"); // an ordinary Friday
  });
});

describe("salaried employee: the holiday is on the factory", () => {
  it("full salary for a month with a holiday, the same as for a month without", () => {
    const withHoliday = record("monthly", dailyPaidDays(month(kindOf), "2000-01-01", (d) => kindOf(d) !== "workday"), dayRate(monthlyRules, monthlyEmp));
    const without = record("monthly", dailyPaidDays(month((d) => kindOfCtx(noHolidays, d)), "2000-01-01", (d) => kindOfCtx(noHolidays, d) !== "workday"), dayRate(monthlyRules, monthlyEmp));
    expect(withHoliday.basicSalary).toBe(6000);
    expect(withHoliday.netSalary).toBe(without.netSalary);
    expect(withHoliday.paidDaysCount).toBeUndefined();
  });

  it("nothing is posted against a holiday — not even for a stray absent record on one", () => {
    expect(postedFor(monthlyEmp, monthlyRules, "absent")).toEqual([]);
    expect(postedFor(monthlyEmp, monthlyRules, "leave")).toEqual([]);
  });

  it("a leave over the Eid charges none of its days", () => {
    // Sun 18 – Thu 22: Sun and Thu are working days, the 3 Eid days are not charged
    expect(chargedLeaveDays("2026-10-18", "2026-10-22", kindOf).map((d) => d.day)).toEqual(["2026-10-18", "2026-10-22"]);
  });
});

describe("daily worker: the holiday is unpaid", () => {
  const rate = dayRate(dailyRules, dailyEmp);

  it("a one-day holiday without work is not a paid day: one day's pay less than the same month without it", () => {
    const oneHoliday = { weeklyOffDays: [5], holidays: [{ from: "2026-10-14", to: "2026-10-14" }] };
    const k = (d: string) => kindOfCtx(oneHoliday, d);
    // the attendance of a full month (present every working day); the holiday has no work
    const days = month((d) => kindOfCtx(noHolidays, d)).filter((d) => d.date !== "2026-10-14");
    const paid = dailyPaidDays(days, "2000-01-01", (d) => k(d) !== "workday");
    const paidWithout = dailyPaidDays(month((d) => kindOfCtx(noHolidays, d)), "2000-01-01", (d) => kindOfCtx(noHolidays, d) !== "workday");
    expect(paid).toBe(paidWithout - 1);
    expect(record("daily", paid, rate).basicSalary).toBe(record("daily", paidWithout, rate).basicSalary - rate);
    expect(record("daily", paid, rate).paidDaysCount).toBe(paid);
  });

  it("an Eid of 3 days is 3 unpaid days, and nothing else is taken for them", () => {
    const full = month((d) => kindOfCtx(noHolidays, d));
    const paidWithout = dailyPaidDays(full, "2000-01-01", (d) => kindOfCtx(noHolidays, d) !== "workday");
    // even if the Eid days carried a status, they are not paid: the day kind decides
    const withEid = full.map((d) => (EID.includes(d.date) ? { ...d, status: "absent" } : d));
    expect(dailyPaidDays(withEid, "2000-01-01", (d) => kindOf(d) !== "workday")).toBe(paidWithout - 3);
    expect(postedFor(dailyEmp, dailyRules, "absent")).toEqual([]);
  });

  it("a holiday on a Friday is counted once: it was never a paid day, and it doesn't remove another", () => {
    const withFridayHoliday = { weeklyOffDays: [5], holidays: [{ from: FRIDAY_HOLIDAY, to: FRIDAY_HOLIDAY }] };
    const k = (d: string) => kindOfCtx(withFridayHoliday, d);
    const paid = dailyPaidDays(month(k), "2000-01-01", (d) => k(d) !== "workday");
    const paidWithout = dailyPaidDays(month((d) => kindOfCtx(noHolidays, d)), "2000-01-01", (d) => kindOfCtx(noHolidays, d) !== "workday");
    expect(paid).toBe(paidWithout);
  });
});

describe("daily worker who works the holiday: by the hour at the holiday multiplier, as before", () => {
  const hourly = hourlyRate(dailyRules, regular, dailyEmp);
  const worked = (date: string) =>
    computeDayPay({ date, kind: kindOf(date), schedule: regular, rules: dailyRules, pay: dailyEmp, actualIn: at(date, "08:00:00"), actualOut: at(date, "13:00:00"), hasPermission: false });

  it("5 hours on an Eid day pay 5 × 2 hours, and the day is still not a paid day", () => {
    const pay = worked(EID[0]);
    expect(pay.items).toEqual([expect.objectContaining({ kind: "holiday", direction: "addition", payHours: 10, amount: Math.round(10 * hourly) })]);
    expect(dailyPaidDays([{ date: EID[0], status: "present" }], "2000-01-01", (d) => kindOf(d) !== "workday")).toBe(0);
  });

  it("work on a holiday that falls on a Friday is paid once, at the holiday multiplier — not also as Friday work", () => {
    const pay = worked(FRIDAY_HOLIDAY);
    expect(pay.items.map((i) => i.kind)).toEqual(["holiday"]);
  });

  it("a salaried employee working the holiday is paid the same way, on top of the full salary", () => {
    const pay = computeDayPay({ date: EID[1], kind: kindOf(EID[1]), schedule: regular, rules: monthlyRules, pay: monthlyEmp, actualIn: at(EID[1], "08:00:00"), actualOut: at(EID[1], "13:00:00"), hasPermission: false });
    expect(pay.items).toEqual([expect.objectContaining({ kind: "holiday", payHours: 10 })]);
  });
});
