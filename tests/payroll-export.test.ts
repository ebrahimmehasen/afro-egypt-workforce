import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { EXPORT_DEDUCTION_TYPES, payrollExportFileName, payrollExportSheet } from "@/lib/payroll-export";
import { getDictionary } from "@/lib/i18n";
import { deductionTypeLabel } from "@/lib/i18n/labels";
import { canAccess, hasPermission, isSelfService } from "@/lib/permissions";
import { employeesInScope, inScope, viewerScope } from "@/lib/scope";
import { COMPANY } from "@/lib/constants";
import type { Department, Employee, PayrollRecord, User } from "@/lib/types";

const t = getDictionary("ar");

const emp = (id: string, name: string, over: Partial<Employee> = {}): Employee => ({
  id,
  employeeNumber: `N-${id}`,
  name,
  departmentId: "D1",
  jobTitle: "x",
  hireDate: "2024-01-01",
  shiftId: "S1",
  salaryType: "monthly",
  basicSalary: 6000,
  dailyWorkingHours: 8,
  allowances: 0,
  status: "active",
  ...over,
});
const rec = (employeeId: string, over: Partial<PayrollRecord> = {}): PayrollRecord => ({
  id: `R-${employeeId}`,
  periodId: "P",
  employeeId,
  basicSalary: 6000,
  allowances: 500,
  overtimeAmount: 200,
  incentives: 100,
  bonuses: 50,
  grossSalary: 6850,
  lateDeduction: 10,
  absenceDeduction: 400,
  earlyLeaveDeduction: 35,
  penalties: 20,
  advances: 300,
  otherDeductions: 15,
  totalDeductions: 780,
  netSalary: 6070,
  ...over,
});
const departments: Department[] = [{ id: "D1", name: "الإنتاج", managerName: "" }];

const build = (records: PayrollRecord[], employees: Employee[], deductions: { employeeId: string; type: string; amount: number }[] = []) =>
  payrollExportSheet({
    records,
    employees,
    departments,
    deductions,
    payTypeOf: (e) => (e.salaryType === "daily" ? "يومية" : "موظف شهري"),
    t,
    locale: "ar",
  });

describe("the payroll details sheet", () => {
  it("has a column for every deduction type, each on its own", () => {
    const { headers } = build([], []);
    expect(EXPORT_DEDUCTION_TYPES).toHaveLength(9);
    for (const type of EXPORT_DEDUCTION_TYPES) expect(headers).toContain(deductionTypeLabel(type, t));
  });

  it("one row per employee, every amount a real number from the stored record", () => {
    const { headers, rows } = build([rec("a"), rec("b")], [emp("a", "أحمد"), emp("b", "بسمة")]);
    expect(rows).toHaveLength(2);
    const col = (h: string) => headers.indexOf(h);
    const r = rows[0];
    expect(r[col(t.payslip.basicSalary)]).toBe(6000);
    expect(r[col(t.payslip.netSalary)]).toBe(6070);
    expect(r[col(t.payroll.export.totalDeductions)]).toBe(780);
    expect(r[col(deductionTypeLabel("absence", t))]).toBe(400);
    // every money cell (basic salary onward) is a number, never text
    const firstMoney = col(t.payslip.basicSalary);
    for (const row of rows) {
      for (let i = firstMoney; i < headers.length; i++) expect(typeof row[i]).toBe("number");
    }
  });

  it("splits the record's combined fields by type from the period's deductions", () => {
    const { headers, rows } = build([rec("a")], [emp("a", "أحمد")], [
      { employeeId: "a", type: "early_leave", amount: 5 },
      { employeeId: "a", type: "permission", amount: 10 },
      { employeeId: "a", type: "unauthorized_exit", amount: 20 },
      { employeeId: "a", type: "admin_deduction", amount: 15 },
    ]);
    const cell = (type: Parameters<typeof deductionTypeLabel>[0]) => rows[0][headers.indexOf(deductionTypeLabel(type, t))];
    // stored earlyLeaveDeduction 35 = 10 permission + 20 without permission + the rest (5) as early leave
    expect(cell("early_leave")).toBe(5);
    expect(cell("permission")).toBe(10);
    expect(cell("unauthorized_exit")).toBe(20);
    // stored otherDeductions 15 = 15 admin + 0 other
    expect(cell("admin_deduction")).toBe(15);
    expect(cell("other")).toBe(0);
  });

  it("the deduction columns always add up to the stored total, even with no posted rows behind the record", () => {
    for (const deductions of [[], [{ employeeId: "a", type: "permission", amount: 999 }]]) {
      const { headers, rows } = build([rec("a")], [emp("a", "أحمد")], deductions);
      const sum = EXPORT_DEDUCTION_TYPES.reduce((s, type) => s + (rows[0][headers.indexOf(deductionTypeLabel(type, t))] as number), 0);
      expect(sum).toBe(rows[0][headers.indexOf(t.payroll.export.totalDeductions)]);
    }
  });

  it("a daily worker shows paid days and day rate; a salaried one leaves them empty", () => {
    const { headers, rows } = build(
      [rec("d", { paidDaysCount: 22, dailyRateApplied: 300, basicSalary: 6600 }), rec("m")],
      [emp("d", "دعاء", { salaryType: "daily" }), emp("m", "مصطفى")],
    );
    const col = (h: string) => headers.indexOf(h);
    const daily = rows.find((r) => r[1] === "دعاء")!;
    const monthly = rows.find((r) => r[1] === "مصطفى")!;
    expect([daily[col(t.payroll.export.paidDays)], daily[col(t.payroll.export.dayRate)], daily[col(t.payslip.basicSalary)]]).toEqual([22, 300, 6600]);
    expect([monthly[col(t.payroll.export.paidDays)], monthly[col(t.payroll.export.dayRate)]]).toEqual([null, null]);
    expect(daily[col(t.payroll.export.payType)]).toBe("يومية");
  });

  it("terminated employees come last, and nobody is left out", () => {
    const { rows } = build(
      [rec("z"), rec("a"), rec("t")],
      [emp("z", "زياد"), emp("a", "أحمد"), emp("t", "تامر", { status: "terminated" })],
    );
    expect(rows.map((r) => r[1])).toEqual(["أحمد", "زياد", "تامر"]);
  });

  it("carries nothing about the company: no name, logo, title row or footer; the table starts at the first cell", () => {
    const { headers, rows } = build([rec("a")], [emp("a", "أحمد")]);
    const text = JSON.stringify({ headers, rows });
    for (const brand of [COMPANY.name, COMPANY.logo, COMPANY.productName, "Afro", "404"]) expect(text).not.toContain(brand);
    expect(headers[0]).toBe(t.payslip.employeeId);
    expect(payrollExportFileName(2026, 10)).toBe("payroll-details-2026-10.xlsx");
  });
});

/**
 * Who may export: the route runs requireAccess("/payroll") (canAccess) and then hasPermission(user, "payroll"),
 * and keeps only the records inside viewerScope. Same role-matrix shape as employee-files-scope.
 */
const user = (over: Partial<User>): User => ({ id: "U", name: "U", email: "u@x.com", role: "employee", permissions: [], ...over });
const mayExport = (u: User) => canAccess(u, "/payroll") && hasPermission(u, "payroll");

describe("who may export", () => {
  it("an admin may", () => {
    expect(mayExport(user({ role: "admin" }))).toBe(true);
  });

  it("an account granted payroll may", () => {
    for (const role of ["hr", "supervisor", "staff"] as const) expect(mayExport(user({ role, permissions: ["payroll"] }))).toBe(true);
  });

  it("an account with other permissions but not payroll may not", () => {
    for (const role of ["hr", "supervisor", "staff"] as const) expect(mayExport(user({ role, permissions: ["employees", "reports"] }))).toBe(false);
  });

  it("a self-service employee, who can open /payroll for their own payslip, may not", () => {
    const self = user({ role: "employee", employeeId: "E1" });
    expect(isSelfService(self)).toBe(true);
    expect(canAccess(self, "/payroll")).toBe(true);
    expect(mayExport(self)).toBe(false);
  });
});

const prisma = new PrismaClient();
let sampleLoaded = false;
let roster: Employee[] = [];
let deptA = "";
try {
  roster = (await prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, departmentId: true } })) as unknown as Employee[];
  deptA = roster[0]?.departmentId ?? "";
  sampleLoaded = roster.length >= 10 && roster.some((e) => e.departmentId !== deptA);
} catch {
  sampleLoaded = false;
}
afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!sampleLoaded)("what an export contains: the viewer's scope", () => {
  it("a department supervisor with payroll gets only their department's employees", () => {
    const supervisor = user({ role: "supervisor", permissions: ["payroll"], departmentIds: [deptA] });
    const scope = viewerScope(supervisor, roster);
    const kept = roster.filter((e) => inScope(scope, e.id));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((e) => e.departmentId === deptA)).toBe(true);
    expect(kept.length).toBeLessThan(roster.length);
  });

  it("an admin, or a payroll account without a department limit, gets everyone", () => {
    for (const u of [user({ role: "admin" }), user({ role: "hr", permissions: ["payroll"] })]) {
      expect(employeesInScope(viewerScope(u, roster), roster)).toHaveLength(roster.length);
    }
  });
});
