import { describe, expect, it } from "vitest";
import { canSeeOverdueReturn, overdueReturns, type OverdueEmployee } from "@/lib/overdue-return";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import type { PayContext } from "@/lib/pay-context";
import type { MidDayInputs } from "@/lib/mid-day-view";
import type { Scope } from "@/lib/scope";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";

/** The pending-return alert for today: pure, no database. Informational: it never creates a punch or a charge. */
const ctx: PayContext = {
  payTypes: [{ ...FALLBACK_PAY_TYPES.monthly, id: "pt", active: true, deletedAt: null }],
  schedules: [],
  shifts: [],
  weeklyOffDays: [5],
  holidays: [],
  payPeriodStartDay: 26,
};
const emp = (id: string, name: string): OverdueEmployee => ({ id, name, shiftId: "s", salaryType: "monthly", payTypeId: "pt", basicSalary: 6000 });
const employees = [emp("E1", "Hossam"), emp("E2", "Mona")];
const DAY = "2026-11-16"; // Monday
const FRIDAY = "2026-11-20";
const at = (d: string, t: string) => new Date(`${d}T${t}`);
const punches = (d: string, ...t: string[]) => t.map((x) => ({ at: at(d, x), source: "biometric" }));
const all: Scope = { all: true };
const permission = (startTime: string, durationMinutes: number) => ({ id: "P1", startTime, durationMinutes });

const run = (inputs: MidDayInputs | undefined, over: Partial<Parameters<typeof overdueReturns>[0]> = {}, now = at(DAY, "13:30")) =>
  overdueReturns({ date: DAY, employees, ctx, scope: all, inputsFor: (id) => (id === "E1" ? inputs : undefined), now, ...over });
const out12 = { punches: punches(DAY, "08:00", "12:00"), permissions: [permission("12:00", 60)] }; // written end 13:00

describe("the pending-return alert", () => {
  it("is silent before the permission's written end", () => {
    expect(run(out12, {}, at(DAY, "12:59"))).toEqual([]);
  });

  it("fires once the end has passed with an exit as the last punch and no return", () => {
    const r = run(out12);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ employeeId: "E1", name: "Hossam", date: DAY, permissionEnd: "13:00" });
    expect(r[0].exitAt).toEqual(at(DAY, "12:00"));
  });

  it("works on a running day with no check-out recorded (it reads punches, not a daily row)", () => {
    expect(run(out12, {}, at(DAY, "13:01"))).toHaveLength(1);
  });

  it("is silent when a return punch exists, and the alert disappears once it does", () => {
    expect(run(out12)).toHaveLength(1);
    expect(run({ ...out12, punches: punches(DAY, "08:00", "12:00", "13:20") })).toEqual([]);
  });

  it("is silent for a permission that reaches the end of the day", () => {
    expect(run({ punches: punches(DAY, "08:00", "15:00"), permissions: [permission("15:00", 240)] }, {}, at(DAY, "20:00"))).toEqual([]);
  });

  it("is silent on a day that is not a working day", () => {
    expect(run({ punches: punches(FRIDAY, "08:00", "12:00"), permissions: [permission("12:00", 60)] }, { date: FRIDAY }, at(FRIDAY, "13:30"))).toEqual([]);
    expect(run(out12, { ctx: { ...ctx, holidays: [{ from: DAY, to: DAY }] } })).toEqual([]);
  });

  it("is silent for an employee out of the viewer's scope", () => {
    expect(run(out12, { scope: { all: false, ids: new Set(["E2"]) } })).toEqual([]);
    expect(run(out12, { scope: { all: false, ids: new Set(["E1"]) } })).toHaveLength(1);
  });

  it("is a different state when there is no exit punch (only a check-in), or a return is already the last punch", () => {
    expect(run({ punches: punches(DAY, "08:00"), permissions: [permission("12:00", 60)] })).toEqual([]);
    expect(run({ punches: punches(DAY, "08:00", "12:00", "12:30"), permissions: [permission("12:00", 60)] })).toEqual([]);
  });

  it("is silent without an approved timed permission, and for an exit that came after the permission's end", () => {
    expect(run({ punches: punches(DAY, "08:00", "12:00"), permissions: [] })).toEqual([]);
    expect(run({ punches: punches(DAY, "08:00", "14:00"), permissions: [permission("12:00", 60)] }, {}, at(DAY, "15:00"))).toEqual([]);
  });

  it("a punch HR entered after reviewing counts as the return; a hand-added pair is not read", () => {
    const reviewed = [...punches(DAY, "08:00", "12:00"), { at: at(DAY, "13:10"), source: "hr_review" }];
    expect(run({ ...out12, punches: reviewed })).toEqual([]);
    const manual = [...punches(DAY, "08:00", "12:00"), { at: at(DAY, "13:10"), source: "manual_correction" }];
    expect(run({ ...out12, punches: manual })).toHaveLength(1);
  });
});

describe("who is shown it, and its strings", () => {
  const user = (over: Partial<User>) => ({ id: "u", name: "x", role: "hr", permissions: [], ...over }) as unknown as User;
  it("the audience is exactly the review-list audience: admin, and HR holding the approve right", () => {
    expect(canSeeOverdueReturn(user({ role: "admin" }))).toBe(true);
    expect(canSeeOverdueReturn(user({ role: "hr", permissions: [] }))).toBe(false);
    expect(canSeeOverdueReturn(user({ role: "employee" } as never))).toBe(false);
  });
  it("has Arabic and English strings", () => {
    for (const d of [ar, en]) {
      expect(d.notifications.overdueReturn.length).toBeGreaterThan(3);
      expect(d.notifications.overdueReturnUntil.length).toBeGreaterThan(3);
    }
  });
});
