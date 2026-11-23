import { describe, expect, it } from "vitest";
import { PayTypeRules, computeDayPay } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { analyzeMidDay, dedupePunches, permissionKind } from "@/lib/mid-day-exits";
import { planSystemRows, systemEntriesFor } from "@/lib/attendance-deductions";
import { rulesFor } from "@/lib/pay-context";
import { calculatePayrollRecord } from "@/lib/payroll-engine";
import { payrollExportSheet } from "@/lib/payroll-export";
import { payrollBreakdownRows } from "@/lib/i18n/labels";
import { getDictionary } from "@/lib/i18n";
import { checkTimedPermission } from "@/lib/permission-request";
import { shortDeductionReason } from "@/lib/deduction-reason";
import type { Employee, PayrollRecord } from "@/lib/types";

/**
 * Exits in the middle of the day and timed permissions, read off the punches. Salary 6000 / 30 = 200 a day,
 * / 10 hours = 20 EGP an hour — so a minute of pay is 1/3 EGP and 60 minutes is 20 EGP. Day 08:00–18:00.
 */
const monthly: PayTypeRules = {
  ...FALLBACK_PAY_TYPES.monthly,
  id: "pt-monthly",
  hoursPerDay: 10,
  graceMinutes: 0,
  permissionMultiplier: 1,
  unauthorizedExitMultiplier: 1.5,
  permissionOverrunMultiplier: 2,
  overtimeMultiplier: 1.5,
  overtimeMinimumMinutes: 60,
  overtimeStepMinutes: 30,
};
const schedule = { start: "08:00", end: "18:00", overtimeStart: "18:00" };
const salary = { basicSalary: 6000 };
const MON = "2026-09-21"; // a Monday
const THU = "2026-09-24"; // a Thursday
const FRI = "2026-09-25";
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`);

type Perm = { startTime: string; durationMinutes: number };
function pay(punches: string[], permissions: Perm[] = [], over: Partial<Parameters<typeof computeDayPay>[0]> = {}) {
  const date = over.date ?? MON;
  const ps = punches.map((p) => at(date, p));
  return computeDayPay({
    date,
    kind: "workday",
    schedule,
    rules: monthly,
    pay: salary,
    actualIn: ps[0] ?? null,
    actualOut: ps.length > 1 ? ps[ps.length - 1] : null,
    hasPermission: false,
    midDay: { punches: ps.map((p) => ({ at: p, source: "biometric" })), permissions: permissions.map((p, i) => ({ id: `P${i}`, ...p })) },
    ...over,
  });
}
const item = (p: ReturnType<typeof computeDayPay>, kind: string) => p.items.find((i) => i.kind === kind);
const kinds = (p: ReturnType<typeof computeDayPay>) => p.items.map((i) => i.kind).sort();

describe("reading the punches: stretches out between the first check-in and the last check-out", () => {
  const dayEnd = at(MON, "18:00");
  const analyze = (punches: string[], permissions: { start: string; durationMinutes: number }[] = [], now?: Date) => {
    const ps = punches.map((p) => at(MON, p));
    return analyzeMidDay({
      punches: ps.map((p) => ({ at: p })),
      actualIn: ps[0],
      actualOut: ps.length > 1 ? ps.at(-1)! : null,
      dayEnd,
      permissions: permissions.map((p, i) => ({ id: `P${i}`, start: at(MON, p.start), durationMinutes: p.durationMinutes })),
      graceMinutes: 0,
      now,
    });
  };

  it("in → out → back → out is one stretch, out to back", () => {
    const a = analyze(["08:00", "11:02", "11:50", "18:00"]);
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0]).toMatchObject({ case: 6, minutes: 48, unauthorizedCharged: 48 });
    expect(a.missingPunch).toBe(false);
  });

  it("two stretches in a day: one on a permission, one without", () => {
    const a = analyze(["08:00", "10:00", "10:30", "13:10", "13:40", "18:00"], [{ start: "10:00", durationMinutes: 60 }]);
    expect(a.intervals.map((i) => [i.case, i.minutes, i.permission?.id ?? null])).toEqual([
      [1, 30, "P0"],
      [6, 30, null],
    ]);
  });

  it("a punch pressed twice within the duplicate window counts once", () => {
    expect(dedupePunches([{ at: at(MON, "11:02") }, { at: new Date(at(MON, "11:02").getTime() + 40_000) }])).toHaveLength(1);
    const a = analyze(["08:00", "11:02", "11:03", "11:50", "18:00"]);
    expect(a.missingPunch).toBe(false);
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0].minutes).toBe(48);
  });

  it("an odd number of punches in the middle of the day is a missing punch, with nothing charged for it (case 7)", () => {
    const a = analyze(["08:00", "11:00", "18:00"]);
    expect(a.missingPunch).toBe(true);
    expect(a.totals).toEqual({ permissionMinutes: 0, overrunCharged: 0, unauthorizedCharged: 0 });
  });

  it("a shift that crosses midnight reads its stretch out across the date change", () => {
    const start = new Date("2026-09-21T22:00:00");
    const out = new Date("2026-09-22T01:00:00");
    const back = new Date("2026-09-22T01:30:00");
    const end = new Date("2026-09-22T06:00:00");
    const a = analyzeMidDay({ punches: [start, out, back, end].map((p) => ({ at: p })), actualIn: start, actualOut: end, dayEnd: end, permissions: [], graceMinutes: 0 });
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0].minutes).toBe(30);
  });

  it("out on a temporary permission that hasn't run out yet: out on permission — not absent, not a missing punch", () => {
    const a = analyze(["08:00", "11:02"], [{ start: "11:00", durationMinutes: 60 }], at(MON, "11:30"));
    expect(a.outOnPermission).toBe(true);
    expect(a.missingPunch).toBe(false);
    // once it has run out, it isn't any more
    expect(analyze(["08:00", "11:02"], [{ start: "11:00", durationMinutes: 60 }], at(MON, "12:30")).outOnPermission).toBe(false);
  });

  it("a day still running where someone came back: the return closes the stretch, no missing punch", () => {
    const a = analyze(["08:00", "11:02", "11:50"], [{ start: "11:00", durationMinutes: 60 }], at(MON, "12:00"));
    expect(a.missingPunch).toBe(false);
    expect(a.intervals[0]).toMatchObject({ case: 1, minutes: 48 });
    expect(a.finalExit).toBeNull();
  });

  it("hand-entered punches (an HR in/out pair) are never read as an exit", () => {
    const ps = ["08:00", "09:00", "17:00", "18:00"].map((p) => at(MON, p));
    const a = analyzeMidDay({
      punches: [{ at: ps[0] }, { at: ps[1], source: "manual_correction" }, { at: ps[2], source: "manual_correction" }, { at: ps[3] }],
      actualIn: ps[0], actualOut: ps[3], dayEnd, permissions: [], graceMinutes: 0,
    });
    expect(a.intervals).toHaveLength(0);
  });

  it("a day corrected by HR: their check-in and check-out stand, the punches in between aren't read", () => {
    const ps = ["08:00", "11:00", "11:30", "18:00"].map((p) => at(MON, p));
    const a = analyzeMidDay({ punches: ps.map((p) => ({ at: p })), actualIn: ps[0], actualOut: ps[3], dayEnd, permissions: [], graceMinutes: 0, corrected: true });
    expect(a.intervals).toHaveLength(0);
  });

  it("the kind follows from the time: ending before the day does is temporary, at or after it is leaving early", () => {
    expect(permissionKind(at(MON, "11:00"), 60, dayEnd)).toBe("temporary");
    expect(permissionKind(at(MON, "17:00"), 60, dayEnd)).toBe("early_leave");
    expect(permissionKind(at(MON, "17:30"), 60, dayEnd)).toBe("early_leave");
  });
});

describe("the rules table, case by case (20 EGP an hour)", () => {
  it("1 — temporary permission, back within it: the actual time out × the permission multiplier", () => {
    const p = pay(["08:00", "11:02", "11:50", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }]);
    expect(item(p, "permission")).toMatchObject({ minutes: 48, multiplier: 1, amount: 16 });
    expect(kinds(p)).toEqual(["permission"]);
    const exact = pay(["08:00", "11:02", "12:02", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }]);
    expect(item(exact, "permission")).toMatchObject({ minutes: 60, amount: 20 });
    expect(item(exact, "permission_overrun")).toBeUndefined();
  });

  it("2 — temporary permission, back after it: the permission in full × 1, and the time past it × 2", () => {
    const p = pay(["08:00", "11:02", "12:20", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }]);
    expect(item(p, "permission")).toMatchObject({ minutes: 60, amount: 20 });
    expect(item(p, "permission_overrun")).toMatchObject({ minutes: 18, multiplier: 2, amount: 12 });
    expect(item(p, "unauthorized_exit")).toBeUndefined();
  });

  it("2 — the grace applies to the time past the permission exactly as to the morning, and follows the setting", () => {
    const withGrace = (graceMinutes: number) =>
      pay(["08:00", "11:02", "12:20", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }], { rules: { ...monthly, graceMinutes } });
    // like the morning: only the minutes after the grace count
    expect(item(withGrace(5), "permission_overrun")?.minutes).toBe(13);
    expect(item(withGrace(10), "permission_overrun")?.minutes).toBe(8);
    // within the grace: nothing past the permission is charged; the permission itself never has a grace
    expect(item(withGrace(20), "permission_overrun")).toBeUndefined();
    expect(item(withGrace(20), "permission")?.minutes).toBe(60);
  });

  it("3 — temporary permission, never back: the permission × 1, the rest of the day × 1.5", () => {
    const p = pay(["08:00", "11:02"].concat(), [{ startTime: "11:00", durationMinutes: 60 }]);
    // one punch only is still a one-punch day — two punches: in 08:00, out 11:02 and nothing after
    expect(p.midDay?.finalExit?.case).toBe(3);
    expect(item(p, "permission")).toMatchObject({ minutes: 60, amount: 20 });
    // 11:02 → 18:00 is 418 minutes: 60 on the permission, 358 without (× 1.5 = 537 minutes = 179 EGP)
    expect(item(p, "unauthorized_exit")).toMatchObject({ minutes: 358, multiplier: 1.5, amount: 179 });
  });

  it("4 — permission to leave early, left at its time: no exit without permission, no missing punch, 60 × 1", () => {
    const p = pay(["08:00", "17:00"], [{ startTime: "17:00", durationMinutes: 60 }]);
    expect(p.midDay?.finalExit?.case).toBe(4);
    expect(p.midDay?.missingPunch).toBe(false);
    expect(kinds(p)).toEqual(["permission"]);
    expect(item(p, "permission")).toMatchObject({ minutes: 60, amount: 20 });
  });

  it("4 — on a Thursday the day ends by the Thursday rule", () => {
    const daily: PayTypeRules = { ...FALLBACK_PAY_TYPES.daily, id: "pt-daily", hoursPerDay: 10, dayDivisor: 30, graceMinutes: 0 };
    const thursdaySchedule = { start: "08:00", end: "18:30", overtimeStart: "18:30" };
    // the Thursday day ends at 16:30, so 15:30 for 60 minutes reaches the end: it is leaving early
    const p = pay(["08:00", "15:30"], [{ startTime: "15:30", durationMinutes: 60 }], { date: THU, rules: daily, schedule: thursdaySchedule });
    expect(p.midDay?.finalExit).toMatchObject({ case: 4, permissionMinutes: 60 });
    expect(kinds(p)).toEqual(["permission"]);
  });

  it("5 — permission to leave early, left before it: the minutes before it × 1.5, the rest × 1, no minute twice", () => {
    const p = pay(["08:00", "16:40"], [{ startTime: "17:00", durationMinutes: 60 }]);
    expect(item(p, "unauthorized_exit")).toMatchObject({ minutes: 20, multiplier: 1.5, amount: 10 });
    expect(item(p, "permission")).toMatchObject({ minutes: 60, amount: 20 });
    // 16:40 → 18:00 is 80 minutes, every one of them in exactly one item
    expect(item(p, "unauthorized_exit")!.minutes + item(p, "permission")!.minutes).toBe(p.earlyMinutes);
  });

  it("6 — out and back with no permission: the whole stretch × 1.5", () => {
    const p = pay(["08:00", "13:10", "13:40", "18:00"]);
    expect(item(p, "unauthorized_exit")).toMatchObject({ minutes: 30, multiplier: 1.5, amount: 15 });
  });

  it("7 — an odd number of punches in the middle: nothing is charged for the exits until HR reviews", () => {
    const p = pay(["08:00", "11:00", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }]);
    expect(p.midDay?.missingPunch).toBe(true);
    expect(p.items).toEqual([]);
  });

  it("8 — overtime is counted exactly as without the permission, and the permission is still charged", () => {
    const withPermission = pay(["08:00", "11:00", "12:00", "20:00"], [{ startTime: "11:00", durationMinutes: 60 }]);
    const plain = computeDayPay({ date: MON, kind: "workday", schedule, rules: monthly, pay: salary, actualIn: at(MON, "08:00"), actualOut: at(MON, "20:00"), hasPermission: false });
    expect(item(withPermission, "overtime")).toEqual(item(plain, "overtime"));
    expect(item(withPermission, "overtime")).toMatchObject({ minutes: 120, amount: 60 });
    expect(item(withPermission, "permission")).toMatchObject({ minutes: 60, amount: 20 });
  });

  it("8 — out in the middle of the day and gone at the end: no overtime at all", () => {
    const p = pay(["08:00", "11:00", "12:00", "18:00"]);
    expect(item(p, "overtime")).toBeUndefined();
    expect(p.overtimeRawMinutes).toBe(0);
  });
});

describe("the multipliers come from the pay type", () => {
  it("the time past a permission follows permissionOverrunMultiplier", () => {
    const p = pay(["08:00", "11:00", "12:30", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }], { rules: { ...monthly, permissionOverrunMultiplier: 3 } });
    // 30 minutes past × 3 = 90 minutes = 30 EGP
    expect(item(p, "permission_overrun")).toMatchObject({ minutes: 30, multiplier: 3, amount: 30 });
  });

  it("with no pay type on file, the safety-net default is × 2", () => {
    expect(rulesFor({ payTypes: [] }, { payTypeId: null, salaryType: "monthly" }).permissionOverrunMultiplier).toBe(2);
    expect(FALLBACK_PAY_TYPES.daily.permissionOverrunMultiplier).toBe(2);
  });

  it("the existing permission multiplier also prices a temporary permission's time", () => {
    const p = pay(["08:00", "11:02", "11:50", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }], { rules: { ...monthly, permissionMultiplier: 2 } });
    expect(item(p, "permission")).toMatchObject({ minutes: 48, multiplier: 2, amount: 32 });
  });
});

describe("what does not change", () => {
  it("a daily worker is charged the same way, at their own hourly wage", () => {
    const daily: PayTypeRules = { ...FALLBACK_PAY_TYPES.daily, id: "pt-daily", hoursPerDay: 10, graceMinutes: 0, thursdayRuleEnabled: false };
    // 300 a day / 10 = 30 an hour; 30 minutes × 1.5 = 45 minutes = 22.5 → 23
    const p = pay(["08:00", "13:10", "13:40", "18:00"], [], { rules: daily, pay: { basicSalary: 0, dailyRate: 300 } });
    expect(item(p, "unauthorized_exit")).toMatchObject({ minutes: 30, amount: 23 });
  });

  it("'له إضافي' off still deducts, like lateness", () => {
    const p = pay(["08:00", "13:10", "13:40", "18:00"], [], { pay: { ...salary, overtimeEligible: false } });
    expect(item(p, "unauthorized_exit")?.amount).toBe(15);
  });

  it("the weekly day off and a public holiday charge none of it", () => {
    for (const kind of ["weekly_off", "holiday"] as const) {
      const p = pay(["08:00", "11:00", "13:00", "15:00"], [{ startTime: "11:00", durationMinutes: 60 }], { date: FRI, kind });
      expect(p.items.every((i) => i.direction === "addition")).toBe(true);
    }
  });

  it("a permission without a time (an older row) is the permission for the rest of the day, exactly as before", () => {
    const employee = { id: "e1", shiftId: "s1", salaryType: "monthly" as const, basicSalary: 6000 };
    const day = { employeeId: "e1", date: MON, status: "early_leave", actualIn: at(MON, "08:00"), actualOut: at(MON, "16:00"), scheduledStart: at(MON, "08:00") };
    const legacy = { type: "permission", createdAt: new Date("2026-09-01") };
    const before = systemEntriesFor(day, employee, monthly, schedule, "workday", legacy);
    const now = systemEntriesFor(day, employee, monthly, schedule, "workday", legacy, undefined, {
      punches: [{ at: at(MON, "08:00") }, { at: at(MON, "16:00") }],
      permissions: [],
    });
    expect(now).toEqual(before);
    expect(before.deductions).toEqual([
      expect.objectContaining({ type: "permission", amount: 40, reason: "إذن لباقي اليوم 2 ساعة × 1" }),
    ]);
  });

  it("a day without any exit or timed permission posts exactly what it posted before", () => {
    const employee = { id: "e1", shiftId: "s1", salaryType: "monthly" as const, basicSalary: 6000 };
    const day = { employeeId: "e1", date: MON, status: "early_leave", actualIn: at(MON, "08:30"), actualOut: at(MON, "17:00"), scheduledStart: at(MON, "08:00") };
    const before = systemEntriesFor(day, employee, monthly, schedule, "workday", null);
    const now = systemEntriesFor(day, employee, monthly, schedule, "workday", null, undefined, {
      punches: [{ at: at(MON, "08:30") }, { at: at(MON, "17:00") }],
      permissions: [],
    });
    expect(now).toEqual(before);
  });
});

describe("posting: one row per kind per day, reasons in Arabic with the calculation", () => {
  const employee = { id: "e1", shiftId: "s1", salaryType: "monthly" as const, basicSalary: 6000 };
  const entries = (punches: string[], permissions: Perm[] = []) => {
    const ps = punches.map((p) => at(MON, p));
    return systemEntriesFor(
      { employeeId: "e1", date: MON, status: "present", actualIn: ps[0], actualOut: ps.at(-1)!, scheduledStart: at(MON, "08:00") },
      employee, monthly, schedule, "workday", null, undefined,
      { punches: ps.map((p) => ({ at: p })), permissions: permissions.map((p, i) => ({ id: `P${i}`, ...p })) },
    ).deductions;
  };

  it("each case writes the formula", () => {
    expect(entries(["08:00", "11:02", "11:50", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }])[0].reason).toBe(
      "إذن 60 دقيقة — خرج 11:02 ورجع 11:50 = 48 دقيقة × 1 = 48 دقيقة خصم",
    );
    const over = entries(["08:00", "11:02", "12:20", "18:00"], [{ startTime: "11:00", durationMinutes: 60 }]);
    expect(over.find((d) => d.type === "permission")!.reason).toBe("إذن 60 دقيقة — خرج 11:02 ورجع 12:20 = 78 دقيقة — الإذن 60 × 1 = 60 دقيقة خصم");
    expect(over.find((d) => d.type === "permission_overrun")!.reason).toBe(
      "زيادة عن الإذن 18 دقيقة × 2 = 36 دقيقة خصم — إذن 60 دقيقة، خرج 11:02 ورجع 12:20 = 78 دقيقة",
    );
    // the list column shows just the phrase before the numbers
    expect(shortDeductionReason(over.find((d) => d.type === "permission_overrun")!.reason)).toBe("زيادة عن الإذن");
    expect(shortDeductionReason(over.find((d) => d.type === "permission")!.reason)).toBe("إذن");
    expect(entries(["08:00", "13:10", "13:40", "18:00"])[0].reason).toBe("خروج بدون إذن — 13:10 ← 13:40 = 30 دقيقة × 1.5 = 45 دقيقة خصم");
    const early = entries(["08:00", "16:40"], [{ startTime: "17:00", durationMinutes: 60 }]);
    expect(early.find((d) => d.type === "unauthorized_exit")!.reason).toBe("خروج قبل الإذن — خرج 16:40 والإذن من 17:00 = 20 دقيقة × 1.5 = 30 دقيقة خصم");
  });

  it("two stretches in one item: one row, the reason spells out each", () => {
    const rows = entries(["08:00", "10:00", "10:20", "13:10", "13:40", "18:00"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "unauthorized_exit", systemKey: `e1|${MON}|unauthorized_exit`, amount: 25 });
    expect(rows[0].reason.split(" | ")).toHaveLength(2);
  });

  it("the system keys never collide: one per kind per day", () => {
    const rows = entries(["08:00", "10:00", "11:30", "13:10", "13:40", "16:40"], [{ startTime: "10:00", durationMinutes: 60 }, { startTime: "17:00", durationMinutes: 60 }]);
    const keys = rows.map((r) => r.systemKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([`e1|${MON}|permission`, `e1|${MON}|permission_overrun`, `e1|${MON}|unauthorized_exit`]);
  });

  it("a row someone edited keeps their value, and one removed is never posted again", () => {
    const desired = entries(["08:00", "13:10", "13:40", "18:00"]);
    const key = desired[0].systemKey;
    expect(planSystemRows(desired, [{ id: "d1", systemKey: key, amount: 5, reason: "x", edited: true, voided: false }])).toEqual({ create: [], update: [], remove: [] });
    expect(planSystemRows(desired, [{ id: "d1", systemKey: key, amount: 5, reason: "x", edited: false, voided: true }])).toEqual({ create: [], update: [], remove: [] });
  });
});

describe("payroll: time past a permission sits with lateness, shown under its own name", () => {
  const t = getDictionary("ar");
  const employee = { id: "e1", employeeNumber: "1", name: "أحمد", departmentId: "d1", salaryType: "monthly", basicSalary: 6000 } as Employee;
  const deductions = [
    { id: "a", employeeId: "e1", type: "late" as const, amount: 10, date: MON, reason: "", createdAt: "" },
    { id: "b", employeeId: "e1", type: "permission_overrun" as const, amount: 12, date: MON, reason: "", createdAt: "" },
    { id: "c", employeeId: "e1", type: "permission" as const, amount: 20, date: MON, reason: "", createdAt: "" },
    { id: "d", employeeId: "e1", type: "unauthorized_exit" as const, amount: 15, date: MON, reason: "", createdAt: "" },
  ];
  const record = { id: "r1", ...calculatePayrollRecord("p1", { employee, allowancesTotal: 0, approvedOvertimeAmount: 0, incentives: 0, bonuses: 0, dayRate: 200, paidDays: 0, deductions }) } as PayrollRecord;

  it("is summed with the late deduction; permission and leaving without one stay in their group", () => {
    expect(record.lateDeduction).toBe(22);
    expect(record.earlyLeaveDeduction).toBe(35);
    expect(record.totalDeductions).toBe(57);
  });

  it("the breakdown and payslip show it on its own line, out of the late deduction", () => {
    const rows = payrollBreakdownRows(record, t, 12).deductions;
    expect(rows.find((r) => r.label === t.payslip.lateDeduction)?.amount).toBe(10);
    expect(rows.find((r) => r.label === t.deductionTypes.permissionOverrun)?.amount).toBe(12);
  });

  it("the export has its own column right after lateness", () => {
    const { headers, rows } = payrollExportSheet({ records: [record], employees: [employee], departments: [], deductions, payTypeOf: () => "", t, locale: "ar" });
    const late = headers.indexOf(t.deductionTypes.late);
    expect(headers[late + 1]).toBe(t.payroll.export.ofWhichPermissionOverrun);
    expect(rows[0][late]).toBe(22);
    expect(rows[0][late + 1]).toBe(12);
  });
});

describe("filing a permission", () => {
  const base = { date: MON, schedule, rules: monthly, dayKind: "workday" as const, locked: false, others: [] };

  it("leaving outside the employee's hours is refused", () => {
    expect(checkTimedPermission({ ...base, startTime: "07:00", durationMinutes: 30 })).toMatchObject({ ok: false, reason: "outside_hours" });
    expect(checkTimedPermission({ ...base, startTime: "18:00", durationMinutes: 30 })).toMatchObject({ ok: false, reason: "outside_hours" });
  });

  it("two permissions overlapping on one day are refused; one without a time overlaps everything", () => {
    expect(checkTimedPermission({ ...base, startTime: "11:30", durationMinutes: 60, others: [{ startTime: "11:00", durationMinutes: 60 }] })).toMatchObject({ ok: false, reason: "overlap" });
    expect(checkTimedPermission({ ...base, startTime: "12:00", durationMinutes: 60, others: [{ startTime: "11:00", durationMinutes: 60 }] })).toMatchObject({ ok: true });
    expect(checkTimedPermission({ ...base, startTime: "12:00", durationMinutes: 60, others: [{ startTime: null, durationMinutes: null }] })).toMatchObject({ ok: false, reason: "overlap" });
  });

  it("no duration, a day off or a locked pay month is refused", () => {
    expect(checkTimedPermission({ ...base, startTime: "11:00", durationMinutes: 0 })).toMatchObject({ ok: false, reason: "duration" });
    expect(checkTimedPermission({ ...base, startTime: "11:00", durationMinutes: 60, dayKind: "weekly_off" })).toMatchObject({ ok: false, reason: "day_off" });
    expect(checkTimedPermission({ ...base, startTime: "11:00", durationMinutes: 60, locked: true })).toMatchObject({ ok: false, reason: "locked" });
  });

  it("the kind is worked out from the time and the employee's hours", () => {
    expect(checkTimedPermission({ ...base, startTime: "11:00", durationMinutes: 60 })).toMatchObject({ ok: true, kind: "temporary" });
    expect(checkTimedPermission({ ...base, startTime: "17:00", durationMinutes: 60 })).toMatchObject({ ok: true, kind: "early_leave" });
    // on a Thursday, by the Thursday rule's earlier end
    const daily: PayTypeRules = { ...FALLBACK_PAY_TYPES.daily, thursdayRuleEnabled: true, thursdayWorkEnd: "16:30" };
    expect(checkTimedPermission({ ...base, date: THU, rules: daily, startTime: "15:30", durationMinutes: 60 })).toMatchObject({ ok: true, kind: "early_leave" });
    expect(checkTimedPermission({ ...base, date: MON, rules: daily, startTime: "15:30", durationMinutes: 60 })).toMatchObject({ ok: true, kind: "temporary" });
  });
});
