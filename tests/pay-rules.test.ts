import { describe, expect, it } from "vitest";
import {
  absenceDaysCharged,
  dailyPaidDays,
  dayRate,
  earlyLeaveDeduction,
  hourlyRate,
  lateDeduction,
  overtimeHourlyRate,
  payPeriodOf,
  payPeriodRange,
  payday,
} from "@/lib/pay-rules";
import { planSystemDeductions, systemDeductionsFor } from "@/lib/attendance-deductions";

const salaried = { salaryType: "monthly" as const, basicSalary: 6000 }; // a day = 200, an hour = 20
const daily = { salaryType: "daily" as const, basicSalary: 5200 }; // a day = 200, an hour = 20

describe("pay rates", () => {
  it("divides a salaried employee's pay by 30 and a daily worker's by 26, and a day into 10 hours", () => {
    expect(dayRate(salaried)).toBe(200);
    expect(dayRate(daily)).toBe(200);
    expect(hourlyRate(salaried)).toBe(20);
    expect(dayRate({ ...daily, dailyRate: 250 })).toBe(250); // a set day rate wins
  });

  it("deducts an hour late as two and a half hours, and early leave only as the time missed", () => {
    expect(lateDeduction(salaried, 60)).toBe(50); // 2.5 h x 20
    expect(lateDeduction(salaried, 12)).toBe(10);
    expect(lateDeduction(salaried, 0)).toBe(0);
    expect(earlyLeaveDeduction(salaried, 30)).toBe(10);
  });

  it("pays an overtime hour as one and a half", () => {
    expect(overtimeHourlyRate(salaried)).toBe(30);
  });
});

describe("absence", () => {
  const day = new Date("2026-09-24T08:00:00");
  const asked = (hoursBefore: number) => new Date(day.getTime() - hoursBefore * 3600_000);

  it("charges approved leave asked 48 hours ahead as one day, and asked later as two", () => {
    expect(absenceDaysCharged("leave", { type: "annual", createdAt: asked(48) }, day)).toBe(1);
    expect(absenceDaysCharged("leave", { type: "annual", createdAt: asked(72) }, day)).toBe(1);
    expect(absenceDaysCharged("leave", { type: "casual", createdAt: asked(47) }, day)).toBe(2);
    expect(absenceDaysCharged("excused_absence", { type: "excused_absence", createdAt: asked(5) }, day)).toBe(2);
  });

  it("charges absence without any leave as two days, and a mission or permission as nothing", () => {
    expect(absenceDaysCharged("absent", null, day)).toBe(2);
    expect(absenceDaysCharged("mission", null, day)).toBe(0);
    expect(absenceDaysCharged("leave", { type: "permission", createdAt: asked(1) }, day)).toBe(0);
    for (const s of ["present", "late", "early_leave", "missing_punch"]) expect(absenceDaysCharged(s, null, day)).toBe(0);
  });
});

describe("the pay month", () => {
  it("runs from the 26th of the month before to the 25th, paid on the 1st of the next", () => {
    expect(payPeriodRange(2026, 10)).toEqual({ from: "2026-09-26", to: "2026-10-25" });
    expect(payPeriodRange(2026, 1)).toEqual({ from: "2025-12-26", to: "2026-01-25" });
    expect(payPeriodRange(2026, 3)).toEqual({ from: "2026-02-26", to: "2026-03-25" });
    expect(payday(2026, 10)).toBe("2026-11-01");
    expect(payday(2026, 12)).toBe("2027-01-01");
  });

  it("puts the 26th onwards into the next month's pay", () => {
    expect(payPeriodOf("2026-09-25")).toEqual({ year: 2026, month: 9 });
    expect(payPeriodOf("2026-09-26")).toEqual({ year: 2026, month: 10 });
    expect(payPeriodOf("2026-12-31")).toEqual({ year: 2027, month: 1 });
  });
});

describe("a daily worker's paid days", () => {
  it("pays worked days, and charges days off through their deduction instead of leaving them unpaid too", () => {
    const days = [
      { date: "2026-09-21", status: "present" },
      { date: "2026-09-22", status: "missing_punch" },
      { date: "2026-09-23", status: "mission" },
      { date: "2026-09-24", status: "absent" }, // charged by the absence deduction
      { date: "2026-09-19", status: "absent" }, // before absences were tracked: simply unpaid
    ];
    expect(dailyPaidDays(days, "2026-09-21")).toBe(4);
  });
});

describe("system deductions for a finished day", () => {
  const base = { employeeId: "e1", date: "2026-09-22", lateMinutes: 0, earlyLeaveMinutes: 0, scheduledStart: new Date("2026-09-22T08:00:00") };

  it("posts two days for an absence without permission, and nothing else that day", () => {
    const [d, ...rest] = systemDeductionsFor({ ...base, status: "absent", lateMinutes: 30 }, salaried, null);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ type: "absence", amount: 400, systemKey: "e1|2026-09-22|absence" });
  });

  it("posts lateness and early leave on a worked day", () => {
    const out = systemDeductionsFor({ ...base, status: "late", lateMinutes: 60, earlyLeaveMinutes: 30 }, salaried, null);
    expect(out.map((d) => [d.type, d.amount])).toEqual([["late", 50], ["early_leave", 10]]);
  });

  it("posts nothing for someone with no salary entered yet", () => {
    expect(systemDeductionsFor({ ...base, status: "absent" }, { ...salaried, basicSalary: 0 }, null)).toEqual([]);
  });
});

describe("keeping posted deductions in step", () => {
  const want = (key: string, amount: number) => ({ systemKey: key, employeeId: "e1", date: "2026-09-22", type: "late" as const, amount, reason: "r" });
  const have = (key: string, amount: number, extra: Partial<{ edited: boolean; voided: boolean }> = {}) => ({
    id: `id-${key}`, systemKey: key, amount, reason: "r", edited: false, voided: false, ...extra,
  });

  it("creates what's missing, updates what changed and removes what no longer applies", () => {
    const plan = planSystemDeductions([want("a", 10), want("b", 20)], [have("b", 15), have("c", 5)]);
    expect(plan.create.map((c) => c.systemKey)).toEqual(["a"]);
    expect(plan.update).toEqual([{ id: "id-b", amount: 20, reason: "r" }]);
    expect(plan.remove).toEqual(["id-c"]);
  });

  it("never touches one a person edited or removed", () => {
    const plan = planSystemDeductions([want("a", 99)], [have("a", 10, { edited: true }), have("x", 5, { voided: true }), have("y", 5, { edited: true })]);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
    // and a removed one is not posted again
    expect(planSystemDeductions([want("x", 5)], [have("x", 5, { voided: true })]).create).toEqual([]);
  });
});
