import { describe, expect, it } from "vitest";
import {
  PayTypeRules,
  absenceDaysCharged,
  computeDayPay,
  countedOvertimeMinutes,
  dayKind,
  dayRate,
  hourlyRate,
  parseWeeklyOffDays,
  resolveSchedule,
} from "@/lib/pay-engine";
import { rulesFor, scheduleFor, PayContext } from "@/lib/pay-context";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { dailyPaidDays, payPeriodOf, payPeriodRange, payday } from "@/lib/pay-rules";
import { lockedDayCheck, planSystemRows, systemEntriesFor } from "@/lib/attendance-deductions";
import { dayPayRows } from "@/lib/day-pay-view";

// A monthly pay type with every rule set explicitly — as an admin would on /settings. hoursPerDay 10 makes
// the hourly wage easy to read: salary 6000 / 30 = 200 a day, / 10 = 20 an hour.
const monthly: PayTypeRules = {
  ...FALLBACK_PAY_TYPES.monthly,
  id: "pt-monthly",
  hoursPerDay: 10,
  lateMultiplier: 1.5,
  overtimeMultiplier: 1.5,
  overtimeMinimumMinutes: 60,
  overtimeStepMinutes: 30,
  permissionMultiplier: 1,
  unauthorizedExitMultiplier: 1.5,
  fridayMultiplier: 2,
  holidayMultiplier: 2,
  graceMinutes: 0,
};
const salary = { basicSalary: 6000 };
const regular = { start: "08:00", end: "16:30", overtimeStart: "16:30" };
// 2026-09-21 is a Monday, 2026-09-24 a Thursday, 2026-09-25 a Friday
const MON = "2026-09-21";
const THU = "2026-09-24";
const FRI = "2026-09-25";
const at = (date: string, time: string) => new Date(`${date}T${time}`);

function day(inTime: string | null, outTime: string | null, over: Partial<Parameters<typeof computeDayPay>[0]> = {}) {
  const date = over.date ?? MON;
  return computeDayPay({
    date,
    kind: "workday",
    schedule: regular,
    rules: monthly,
    pay: salary,
    actualIn: inTime ? at(date, inTime) : null,
    actualOut: outTime ? at(date, outTime) : null,
    hasPermission: false,
    ...over,
  });
}
const item = (pay: ReturnType<typeof computeDayPay>, kind: string) => pay.items.find((i) => i.kind === kind);

describe("rates come from the pay type", () => {
  it("divides the salary by the pay type's divisor and the day by its hours", () => {
    expect(dayRate(monthly, salary)).toBe(200);
    expect(hourlyRate(monthly, regular, salary)).toBe(20);
    expect(dayRate({ basis: "daily", dayDivisor: 26 }, { basicSalary: 5200 })).toBe(200);
    expect(dayRate({ basis: "daily", dayDivisor: 26 }, { basicSalary: 5200, dailyRate: 250 })).toBe(250);
  });

  it("without a set number of hours, a day's pay covers the schedule from start to overtime start", () => {
    expect(hourlyRate({ ...monthly, hoursPerDay: null }, regular, salary)).toBeCloseTo(200 / 8.5, 6);
  });
});

describe("a salaried employee on 08:00 → 16:30", () => {
  it("on time, leaving at the end: nothing added or taken", () => {
    expect(day("08:00:00", "16:30:00").items).toEqual([]);
  });

  it("10 minutes late at ×1.5 costs 15 minutes of pay", () => {
    const late = item(day("08:10:00", "16:30:00"), "late")!;
    expect(late.minutes).toBe(10);
    expect(late.payHours).toBeCloseTo(0.25, 10); // 15 minutes
    expect(late.amount).toBe(5); // 0.25 h × 20
  });

  it("counts lateness to the second, without rounding it away", () => {
    expect(item(day("08:10:30", "16:30:00"), "late")!.minutes).toBeCloseTo(10.5, 10);
  });

  it("30 minutes of overtime is under the minimum and not counted", () => {
    const pay = day("08:00:00", "17:00:00");
    expect(pay.overtimeRawMinutes).toBe(30);
    expect(item(pay, "overtime")).toBeUndefined();
  });

  it("1.5 hours of overtime at ×1.5 is 2.25 hours of pay — the worked example", () => {
    const pay = day("08:00:00", "18:00:00");
    expect(pay.workedMinutes / 60).toBe(10);
    const ot = item(pay, "overtime")!;
    expect(ot.minutes / 60).toBe(1.5);
    expect(ot.payHours).toBe(2.25);
    expect(ot.amount).toBe(45);
  });

  it("counts overtime in whole steps only", () => {
    expect(countedOvertimeMinutes(100, { overtimeMinimumMinutes: 60, overtimeStepMinutes: 30 })).toBe(90);
    expect(countedOvertimeMinutes(100, { overtimeMinimumMinutes: 60, overtimeStepMinutes: 60 })).toBe(60);
    expect(countedOvertimeMinutes(59, { overtimeMinimumMinutes: 60, overtimeStepMinutes: 1 })).toBe(0);
  });

  it("leaving 2 hours early without permission costs 2 × 1.5 = 3 hours", () => {
    const exit = item(day("08:00:00", "14:30:00"), "unauthorized_exit")!;
    expect(exit.minutes).toBe(120);
    expect(exit.payHours).toBe(3);
  });

  it("leaving 3 hours early on a permission for the rest of the day costs 3 × 1 = 3 hours, not the exit rate", () => {
    const pay = day("08:00:00", "13:30:00", { hasPermission: true });
    expect(item(pay, "unauthorized_exit")).toBeUndefined();
    expect(item(pay, "permission")!.payHours).toBe(3);
  });

  it("a day with a single punch earns and costs nothing until HR reviews it", () => {
    expect(day("08:30:00", null).items).toEqual([]);
  });
});

describe("the weekly day off and public holidays", () => {
  it("8 hours on Friday pay 8 × 2 = 16 hours, with no lateness or overtime", () => {
    const pay = day("09:00:00", "17:00:00", { date: FRI, kind: "weekly_off" });
    expect(pay.items).toHaveLength(1);
    expect(item(pay, "friday")!.payHours).toBe(16);
  });

  it("5 hours on a public holiday pay 5 × 2 = 10 hours", () => {
    const pay = day("08:00:00", "13:00:00", { kind: "holiday" });
    expect(item(pay, "holiday")!.payHours).toBe(10);
  });

  it("knows which kind of day a date is, from the settings", () => {
    const off = parseWeeklyOffDays("5");
    expect(dayKind(FRI, off, [])).toBe("weekly_off");
    expect(dayKind(MON, off, [{ from: MON, to: MON }])).toBe("holiday");
    expect(dayKind(MON, off, [])).toBe("workday");
    expect(dayKind(FRI, parseWeeklyOffDays("5,6"), [])).toBe("weekly_off");
    expect(parseWeeklyOffDays("x, 9, 6")).toEqual([6]);
  });
});

describe("a daily worker, 08:00 → 18:30, whose Thursday ends at 16:30", () => {
  const daily: PayTypeRules = { ...FALLBACK_PAY_TYPES.daily, id: "pt-daily", hoursPerDay: 10, thursdayRuleEnabled: true, thursdayWorkEnd: "16:30", thursdayExtraMultiplier: 1 };
  const times = { start: "08:00", end: "18:30", overtimeStart: "18:30" };
  const pay = { basicSalary: 5200 }; // 200 a day, 20 an hour
  const worker = (date: string, inT: string, outT: string) =>
    computeDayPay({ date, kind: "workday", schedule: times, rules: daily, pay, actualIn: at(date, inT), actualOut: at(date, outT), hasPermission: false });

  it("an ordinary day to 18:30: nothing extra", () => {
    expect(worker(MON, "08:00:00", "18:30:00").items).toEqual([]);
  });

  it("on Thursday, leaving at 16:30 is the end of the day — not leaving early", () => {
    expect(worker(THU, "08:00:00", "16:30:00").items).toEqual([]);
  });

  it("on Thursday, working on to 18:30 pays those 2 hours as normal time (1 hour = 1 hour), not overtime", () => {
    const p = worker(THU, "08:00:00", "18:30:00");
    expect(item(p, "overtime")).toBeUndefined();
    const extra = item(p, "thursday_extra")!;
    expect(extra.minutes).toBe(120);
    expect(extra.payHours).toBe(2);
  });

  it("the Thursday rule is a setting: switched off, Thursday is an ordinary day", () => {
    const off = computeDayPay({ date: THU, kind: "workday", schedule: times, rules: { ...daily, thursdayRuleEnabled: false }, pay, actualIn: at(THU, "08:00:00"), actualOut: at(THU, "16:30:00"), hasPermission: false });
    expect(item(off, "unauthorized_exit")!.minutes).toBe(120);
  });
});

describe("nothing is fixed in code: changing a setting changes the result", () => {
  it("a new pay type with its own numbers", () => {
    const shiftWork: PayTypeRules = { ...monthly, id: "pt-new", name: "مقاولة", overtimeMultiplier: 2, lateMultiplier: 2, fridayMultiplier: 3, permissionMultiplier: 0.5 };
    expect(item(day("08:00:00", "18:00:00", { rules: shiftWork }), "overtime")!.payHours).toBe(3); // 1.5 × 2
    expect(item(day("08:10:00", "16:30:00", { rules: shiftWork }), "late")!.payHours).toBeCloseTo(20 / 60, 10); // 10 × 2 min
    expect(item(day("09:00:00", "17:00:00", { rules: shiftWork, kind: "weekly_off", date: FRI }), "friday")!.payHours).toBe(24);
    expect(item(day("08:00:00", "13:30:00", { rules: shiftWork, hasPermission: true }), "permission")!.payHours).toBe(1.5);
  });

  it("editing a work schedule moves where lateness and overtime start", () => {
    const later = { start: "09:00", end: "17:30", overtimeStart: "17:30" };
    expect(item(day("08:55:00", "18:00:00", { schedule: later }), "late")).toBeUndefined();
    expect(item(day("08:55:00", "18:00:00", { schedule: later }), "overtime")).toBeUndefined(); // 30 min < minimum
  });

  it("a grace period only counts the lateness beyond it", () => {
    expect(item(day("08:12:00", "16:30:00", { rules: { ...monthly, graceMinutes: 10 } }), "late")!.minutes).toBe(2);
  });
});

describe("the employee's times", () => {
  const schedule = { startTime: "08:00", endTime: "18:00" };
  it("custom times win, then the fixed schedule, then the pay type, then the shift", () => {
    expect(resolveSchedule({ custom: { start: "07:00", end: "15:00" }, schedule })).toMatchObject({ start: "07:00", source: "custom", overtimeStart: "15:00" });
    expect(resolveSchedule({ schedule, payType: monthly })).toMatchObject({ start: "08:00", end: "18:00", source: "schedule" });
    expect(resolveSchedule({ payType: { workStart: "08:00", workEnd: "18:30", overtimeStart: null } })).toMatchObject({ end: "18:30", overtimeStart: "18:30", source: "pay_type" });
    expect(resolveSchedule({ shift: { startTime: "16:00", endTime: "00:00" } })).toMatchObject({ source: "shift" });
  });
});

describe("older employees and data", () => {
  const ctx = {
    payTypes: [{ ...monthly, code: "monthly", active: true, deletedAt: null }],
    schedules: [],
    shifts: [{ id: "s1", name: "morning", startTime: "08:00", endTime: "18:00", gracePeriodMinutes: 0, workDays: [], allowOvertime: true }],
    weeklyOffDays: [5],
    holidays: [],
    payPeriodStartDay: 26,
  } as PayContext;

  it("an employee saved before pay types existed gets the built-in type for their pay basis", () => {
    expect(rulesFor(ctx, { payTypeId: null, salaryType: "monthly" }).id).toBe("pt-monthly");
  });

  it("with no pay type rows at all, the safety-net defaults still calculate instead of breaking", () => {
    expect(rulesFor({ payTypes: [] }, { payTypeId: "gone", salaryType: "daily" }).dayDivisor).toBe(FALLBACK_PAY_TYPES.daily.dayDivisor);
  });

  it("an employee with neither schedule nor custom times keeps their shift's times", () => {
    const e = { id: "e1", shiftId: "s1", salaryType: "monthly" as const, basicSalary: 6000, payTypeId: null };
    expect(scheduleFor({ ...ctx, payTypes: [{ ...monthly, workStart: null, workEnd: null, overtimeStart: null, active: true, deletedAt: null }] }, e)).toMatchObject({ start: "08:00", end: "18:00" });
  });
});

describe("absence, by the pay type's rules", () => {
  const dayStart = at(MON, "08:00:00");
  const asked = (hoursBefore: number) => new Date(dayStart.getTime() - hoursBefore * 3_600_000);
  it("permitted leave asked in time costs its days; late or none costs the unpermitted days; a mission nothing", () => {
    expect(absenceDaysCharged("leave", { type: "annual", createdAt: asked(48) }, dayStart, monthly)).toBe(1);
    expect(absenceDaysCharged("leave", { type: "annual", createdAt: asked(10) }, dayStart, monthly)).toBe(2);
    expect(absenceDaysCharged("absent", null, dayStart, monthly)).toBe(2);
    expect(absenceDaysCharged("mission", null, dayStart, monthly)).toBe(0);
    expect(absenceDaysCharged("absent", null, dayStart, { ...monthly, unpermittedAbsenceDays: 1.25 })).toBe(1.25);
  });
});

describe("the pay month, from the start-day setting", () => {
  it("runs from that day of the month before; 1 means the calendar month", () => {
    expect(payPeriodRange(2026, 10, 26)).toEqual({ from: "2026-09-26", to: "2026-10-25" });
    expect(payPeriodRange(2026, 1, 26)).toEqual({ from: "2025-12-26", to: "2026-01-25" });
    expect(payPeriodRange(2026, 2, 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(payPeriodOf("2026-09-26", 26)).toEqual({ year: 2026, month: 10 });
    expect(payPeriodOf("2026-09-26", 1)).toEqual({ year: 2026, month: 9 });
    expect(payday(2026, 12)).toBe("2027-01-01");
  });

  it("an approved or closed pay month is locked", () => {
    const locked = lockedDayCheck([{ year: 2026, month: 9 }], { payPeriodStartDay: 26 });
    expect(locked("2026-09-25")).toBe(true);
    expect(locked("2026-09-26")).toBe(false);
  });
});

describe("a daily worker's paid days", () => {
  it("pays worked days and charged days off, but not work on days off (paid by the hour instead)", () => {
    const days = [
      { date: MON, status: "present" },
      { date: "2026-09-22", status: "absent" },
      { date: FRI, status: "present" },
      { date: "2026-09-19", status: "absent" }, // before tracking
    ];
    expect(dailyPaidDays(days, MON, (d) => d === FRI)).toBe(2);
  });
});

describe("posting and hand edits", () => {
  const employee = { id: "e1", shiftId: "s1", salaryType: "monthly" as const, basicSalary: 6000 };
  const base = { employeeId: "e1", date: MON, status: "late", scheduledStart: at(MON, "08:00:00") };

  it("a finished day posts its deductions and additions, each with the rule and number in its reason", () => {
    const e = systemEntriesFor({ ...base, actualIn: at(MON, "08:10:00"), actualOut: at(MON, "18:00:00") }, employee, monthly, regular, "workday", null);
    expect(e.deductions.map((d) => [d.type, d.amount])).toEqual([["late", 5]]);
    expect(e.additions.map((a) => [a.kind, a.hours, a.multiplier, a.amount])).toEqual([["overtime", 1.5, 1.5, 45]]);
    expect(e.additions[0].reason).toContain("2.25");
  });

  it("an absence is charged in days, and nothing else that day", () => {
    const e = systemEntriesFor({ ...base, status: "absent", actualIn: null, actualOut: null }, employee, monthly, regular, "workday", null);
    expect(e.deductions).toMatchObject([{ type: "absence", amount: 400 }]);
    expect(e.additions).toEqual([]);
  });

  const want = (key: string, amount: number) => ({ systemKey: key, amount, reason: "r" });
  const have = (key: string, amount: number, extra: Partial<{ edited: boolean; voided: boolean }> = {}) => ({ id: `id-${key}`, systemKey: key, amount, reason: "r", edited: false, voided: false, ...extra });

  it("keeps posted entries in step, but never touches one a person edited or removed", () => {
    const plan = planSystemRows([want("a", 10), want("b", 20)], [have("b", 15), have("c", 5)]);
    expect(plan.create.map((c) => c.systemKey)).toEqual(["a"]);
    expect(plan.update.map((u) => u.id)).toEqual(["id-b"]);
    expect(plan.remove).toEqual(["id-c"]);
    expect(planSystemRows([want("x", 99)], [have("x", 10, { edited: true })])).toEqual({ create: [], update: [], remove: [] });
    expect(planSystemRows([want("x", 5)], [have("x", 5, { voided: true })]).create).toEqual([]);
  });

  it("the employee page shows an edited overtime with the calculated value next to it, and a removed one as removed", () => {
    const rows = dayPayRows({
      employee,
      rules: monthly,
      schedule: regular,
      days: [{ ...base, actualIn: at(MON, "08:00:00"), actualOut: at(MON, "18:00:00"), kind: "workday" }],
      leaveFor: () => null,
      posted: [{ systemKey: `e1|${MON}|overtime`, amount: 60, originalAmount: 45, editedBy: "Admin", removed: false }],
    });
    expect(rows[0].lines).toEqual([expect.objectContaining({ type: "overtime", amount: 60, calculated: 45, editedBy: "Admin" })]);
    expect(rows[0].net).toBe(60);
    expect(rows[0].overtimePayHours).toBe(2.25);

    const removed = dayPayRows({
      employee,
      rules: monthly,
      schedule: regular,
      days: [{ ...base, actualIn: at(MON, "08:00:00"), actualOut: at(MON, "18:00:00"), kind: "workday" }],
      leaveFor: () => null,
      posted: [{ systemKey: `e1|${MON}|overtime`, amount: 45, originalAmount: 45, editedBy: null, removed: true }],
    });
    expect(removed[0].lines[0]).toMatchObject({ amount: 0, calculated: 45, removed: true });
    expect(removed[0].net).toBe(0);
  });
});
