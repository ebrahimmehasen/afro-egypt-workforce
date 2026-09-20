import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  companyOverview,
  executeTool,
  findDataGaps,
  getEmployee,
  searchEmployees,
} from "@/lib/assistant/employee-tools";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { ctx } from "./helpers/assistant-fixture";

describe("search_employees", () => {
  it("finds by partial name and reports how many matched", () => {
    const r = searchEmployees(ctx, { query: "سامي" });
    expect(r.total).toBe(2);
    expect(r.employees.map((e) => e.employeeNumber)).toEqual(["PROD-001", "PROD-002"]);
  });

  it("filters by department and status, and honours the limit", () => {
    expect(searchEmployees(ctx, { department: "إنتاج" }).total).toBe(3);
    expect(searchEmployees(ctx, { status: "terminated" }).employees[0].employeeNumber).toBe("PROD-003");
    const limited = searchEmployees(ctx, { department: "إنتاج", limit: 1 });
    expect(limited).toMatchObject({ total: 3, showing: 1 });
    expect(limited.employees).toHaveLength(1);
  });
});

describe("get_employee", () => {
  it("returns the whole file for an employee number, without any internal id", () => {
    const r = getEmployee(ctx, { query: "prod-001" }); // case-insensitive
    expect(r).toMatchObject({ identity: { employeeNumber: "PROD-001", department: "الإنتاج" }, pay: { basicSalary: 5000 } });
    expect(JSON.stringify(r)).not.toContain("secret-id");
  });

  it("counts documents on file and lists the required ones still missing", () => {
    const r = getEmployee(ctx, { query: "PROD-001" }) as { documents: { onFile: { files: number }[]; missing: string[] } };
    expect(r.documents.onFile).toContainEqual({ type: ar.documents.types.national_id_photo, files: 2 });
    expect(r.documents.missing).not.toContain(ar.documents.types.national_id_photo);
    expect(r.documents.missing).toContain(ar.documents.types.work_contract);
  });

  it("summarises the last 30 days of attendance, overtime and deductions", () => {
    const r = getEmployee(ctx, { query: "PROD-001" }) as {
      attendanceLast30Days: { byStatus: Record<string, number>; totalLateMinutes: number };
      overtimeLast90Days: { approvedHours: number };
      deductionsLast90Days: { total: number };
      pay: { lastPayroll: { net: number } };
    };
    expect(r.attendanceLast30Days.byStatus).toEqual({ present: 1, late: 1 });
    expect(r.attendanceLast30Days.totalLateMinutes).toBe(25);
    expect(r.overtimeLast90Days.approvedHours).toBe(3);
    expect(r.deductionsLast90Days.total).toBe(100);
    expect(r.pay.lastPayroll.net).toBe(5100);
  });

  it("says so when nobody matches, and asks which one when a name is ambiguous", () => {
    expect(getEmployee(ctx, { query: "لا يوجد" })).toMatchObject({ found: false });
    const amb = getEmployee(ctx, { query: "سامي" }) as { ambiguous: boolean; candidates: unknown[] };
    expect(amb.ambiguous).toBe(true);
    expect(amb.candidates).toHaveLength(2);
    expect(JSON.stringify(amb)).not.toContain("secret-id");
  });

  it("asks for a query instead of guessing", () => {
    expect(getEmployee(ctx, {})).toEqual({ error: "query is required" });
  });
});

describe("find_data_gaps", () => {
  it("ranks the worst records first and leaves out people who left", () => {
    const r = findDataGaps(ctx, {});
    expect(r.employeesChecked).toBe(3); // the terminated one is excluded
    const numbers = r.employees.map((e) => e.employeeNumber);
    expect(numbers).not.toContain("PROD-003");
    expect(r.employees[0].totalGaps).toBeGreaterThanOrEqual(r.employees[1].totalGaps);
  });

  it("flags missing profile data by name, including an unassigned department and zero salary", () => {
    const r = findDataGaps(ctx, {});
    const tbd = r.employees.find((e) => e.employeeNumber === "TBD-001")!;
    expect(tbd.missingProfileData).toEqual(expect.arrayContaining(["القسم", "المرتب"]));
    const p2 = r.employees.find((e) => e.employeeNumber === "PROD-002")!;
    expect(p2.missingProfileData).toEqual(expect.arrayContaining(["الرقم القومي", "رقم التليفون", "المرتب"]));
  });

  it("tallies what is missing most across the company and never exposes ids", () => {
    const r = findDataGaps(ctx, {});
    expect(r.mostMissingDocuments[0].employees).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain("secret-id");
  });

  it("can be limited to a department", () => {
    expect(findDataGaps(ctx, { department: "غير محدد" }).employeesChecked).toBe(1);
  });
});

describe("company_overview", () => {
  it("reports headcount, hires, data quality and attendance highlights", () => {
    const r = companyOverview(ctx);
    expect(r.headcount).toEqual({ total: 4, active: 3, onLeave: 0, terminated: 1 });
    expect(r.recentHires.list.map((h) => h.employeeNumber)).toEqual(["TBD-001"]);
    expect(r.dataQuality).toMatchObject({ employeesWithoutRealDepartment: 1, employeesWithoutSalary: 2 });
    expect(r.attendanceLast30Days).toMatchObject({ absences: 1, lateArrivals: 1 });
    expect(r.attendanceLast30Days.mostAbsent[0]).toMatchObject({ employeeNumber: "PROD-002", days: 1 });
    expect(JSON.stringify(r)).not.toContain("secret-id");
  });

  it("only averages salaries that have actually been entered", () => {
    const prod = companyOverview(ctx).byDepartment.find((d) => d.department === "الإنتاج")!;
    expect(prod.employees).toBe(2); // the terminated one isn't counted
    expect(prod.employeesWithSalaryEntered).toBe(1);
    expect(prod.averageMonthlySalary).toBe(5000);
  });
});

describe("executeTool", () => {
  it("dispatches by name", () => {
    expect(executeTool("search_employees", { query: "منى" }, ctx)).toMatchObject({ total: 1 });
    expect(executeTool("company_overview", {}, ctx)).toHaveProperty("headcount");
  });

  it("returns a readable error for an unknown tool and tolerates junk arguments", () => {
    expect(executeTool("drop_database", {}, ctx)).toEqual({ error: "Unknown tool: drop_database" });
    expect(executeTool("search_employees", "not an object", ctx)).toHaveProperty("total");
    expect(executeTool("search_employees", { limit: "abc", status: 5 }, ctx)).toHaveProperty("employees");
  });
});

describe("buildSnapshot", () => {
  const snapshot = buildSnapshot(ctx);

  it("carries company-wide figures", () => {
    const parsed = JSON.parse(snapshot);
    expect(parsed).toMatchObject({ asOf: "2026-09-20", headcount: { total: 4, active: 3 }, hiredInLast3Months: 1 });
    expect(parsed.byDepartment.length).toBeGreaterThan(0);
    expect(parsed.dataQuality).toHaveProperty("employeesWithoutSalary");
  });

  it("contains nothing about any individual: no names, no employee numbers, no internal ids", () => {
    for (const person of ["سامي", "منى", "PROD-001", "PROD-002", "TBD-001", "secret-id", "01000000000", "00000000000000"]) {
      expect(snapshot).not.toContain(person);
    }
  });
});
