import { afterAll, describe, expect, it, vi } from "vitest";
import { PayTypeRules, computeDayPay } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import type { User } from "@/lib/types";
import { PrismaClient } from "@prisma/client";

/**
 * "له إضافي" off = nothing on the overtime page at all: no overtime, no weekly-day-off or public-holiday work,
 * no Thursday time. Lateness and leaving early are still charged. With it on, all of it is paid as before.
 */
const common = { hoursPerDay: 10, graceMinutes: 0, overtimeMultiplier: 1.5, overtimeMinimumMinutes: 60, overtimeStepMinutes: 30, fridayMultiplier: 2, holidayMultiplier: 2 };
const monthly: PayTypeRules = { ...FALLBACK_PAY_TYPES.monthly, ...common, id: "pt-monthly", thursdayRuleEnabled: false };
const daily: PayTypeRules = { ...FALLBACK_PAY_TYPES.daily, ...common, id: "pt-daily", thursdayRuleEnabled: true, thursdayWorkEnd: "16:30", thursdayExtraMultiplier: 1 };
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);
// 2026-10-12 Monday, 2026-10-15 Thursday, 2026-10-16 Friday
const pay = (rules: PayTypeRules, eligible: boolean, date: string, inTime: string, outTime: string, kind: "workday" | "weekly_off" | "holiday" = "workday", schedule = { start: "08:00", end: "16:30", overtimeStart: "16:30" }) =>
  computeDayPay({ date, kind, schedule, rules, pay: { basicSalary: 6000, dailyRate: 230, overtimeEligible: eligible }, actualIn: at(date, inTime), actualOut: at(date, outTime), hasPermission: false });
const kinds = (p: ReturnType<typeof computeDayPay>) => p.items.map((i) => i.kind);
const thursdaySchedule = { start: "08:00", end: "18:30", overtimeStart: "18:30" };

describe("له إضافي off: no addition of any kind", () => {
  it("no overtime for staying late", () => {
    expect(kinds(pay(monthly, false, "2026-10-12", "08:00", "18:30"))).toEqual([]);
  });

  it("no pay for work on the weekly day off or a public holiday", () => {
    expect(kinds(pay(daily, false, "2026-10-16", "08:00", "13:00", "weekly_off"))).toEqual([]);
    expect(kinds(pay(monthly, false, "2026-10-12", "08:00", "13:00", "holiday"))).toEqual([]);
  });

  it("no Thursday time", () => {
    expect(kinds(pay(daily, false, "2026-10-15", "08:00", "20:30", "workday", thursdaySchedule))).toEqual([]);
  });

  it("lateness and leaving early are still charged", () => {
    expect(kinds(pay(monthly, false, "2026-10-12", "08:30", "15:30"))).toEqual(["late", "unauthorized_exit"]);
  });
});

describe("له إضافي on: everything as before", () => {
  it("overtime, Friday / holiday work and Thursday time are all paid", () => {
    expect(kinds(pay(monthly, true, "2026-10-12", "08:00", "18:30"))).toEqual(["overtime"]);
    expect(kinds(pay(daily, true, "2026-10-16", "08:00", "13:00", "weekly_off"))).toEqual(["friday"]);
    expect(kinds(pay(monthly, true, "2026-10-12", "08:00", "13:00", "holiday"))).toEqual(["holiday"]);
    expect(kinds(pay(daily, true, "2026-10-15", "08:00", "20:30", "workday", thursdaySchedule))).toEqual(["thursday_extra", "overtime"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Manual entries, through the real createOvertime on the sample-seeded dev database (skipped anywhere else).

let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { createOvertime } = await import("@/lib/actions/overtime");
const prisma = new PrismaClient();
let sampleDb = false;
let eligibleId = "";
const NOT_ELIGIBLE = "ZZ-OTE-001";
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
  if (sampleDb) {
    const seed = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" }, overtimeEligible: true }, orderBy: { id: "asc" } });
    eligibleId = seed.id;
    await prisma.employee.deleteMany({ where: { id: NOT_ELIGIBLE } });
    await prisma.employee.create({
      data: { id: NOT_ELIGIBLE, employeeNumber: "ZZOTE-001", name: "اختبار بلا إضافي", departmentId: seed.departmentId, jobTitle: "x", hireDate: new Date("2024-01-01"), shiftId: seed.shiftId, basicSalary: 6000, overtimeEligible: false },
    });
  }
} catch {
  sampleDb = false;
}
const NOTE = "اختبار إضافي يدوي";
const entry = (employeeId: string) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ employeeId, date: "2030-04-07", hours: "2", hourlyRate: "50", notes: NOTE })) f.set(k, v);
  return createOvertime({}, f);
};
afterAll(async () => {
  if (sampleDb) {
    await prisma.overtime.deleteMany({ where: { notes: NOTE } });
    await prisma.employee.deleteMany({ where: { id: NOT_ELIGIBLE } });
  }
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("a manual overtime entry", () => {
  it("is refused for an employee whose له إضافي is off — even by the admin", async () => {
    session = { id: "U-admin", name: "x", email: "a@x", role: "admin", permissions: [] };
    expect(await entry(NOT_ELIGIBLE)).toHaveProperty("error");
    expect(await prisma.overtime.count({ where: { employeeId: NOT_ELIGIBLE } })).toBe(0);
  });

  it("is refused for an account without the overtime permission", async () => {
    session = { id: "U-x", name: "x", email: "x@x", role: "supervisor", permissions: ["employees"] };
    expect(await entry(eligibleId)).toHaveProperty("error");
  });

  it("goes in, pending, for an employee with له إضافي and an account with overtime", async () => {
    session = { id: "U-ot", name: "x", email: "o@x", role: "supervisor", permissions: ["overtime"] };
    expect(await entry(eligibleId)).toMatchObject({ success: true });
    expect(await prisma.overtime.findFirstOrThrow({ where: { notes: NOTE } })).toMatchObject({ employeeId: eligibleId, status: "pending" });
  });
});
