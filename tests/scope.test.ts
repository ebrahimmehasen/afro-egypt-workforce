import { describe, expect, it } from "vitest";
import { employeesInScope, inScope, rowsInScope, viewerScope } from "@/lib/scope";
import type { Employee, User } from "@/lib/types";

const emp = (id: string, departmentId: string): Employee => ({
  id,
  employeeNumber: id,
  name: id,
  departmentId,
  jobTitle: "worker",
  hireDate: "2026-01-01",
  shiftId: "SHIFT-1",
  salaryType: "monthly",
  basicSalary: 5000,
  dailyWorkingHours: 8,
  allowances: 0,
  biometricDeviceUserId: id,
  status: "active",
});

const roster = [emp("E1", "D1"), emp("E2", "D1"), emp("E3", "D2"), emp("E4", "D2")];

const user = (over: Partial<User>): User => ({
  id: "U",
  name: "U",
  email: "u@x.com",
  role: "employee",
  ...over,
});

describe("viewerScope", () => {
  it("admin sees the whole company", () => {
    const scope = viewerScope(user({ role: "admin" }), roster);
    expect(scope.all).toBe(true);
    expect(employeesInScope(scope, roster)).toHaveLength(4);
  });

  it("hr/supervisor with no departmentIds is company-wide (the free-list default)", () => {
    for (const role of ["hr", "supervisor"] as const) {
      const scope = viewerScope(user({ role }), roster);
      expect(scope.all).toBe(true);
      expect(employeesInScope(scope, roster)).toHaveLength(4);
    }
  });

  it("hr/supervisor scoped to specific departmentIds sees only those departments", () => {
    const scope = viewerScope(user({ role: "supervisor", departmentIds: ["D1"] }), roster);
    expect(scope.all).toBe(false);
    expect(employeesInScope(scope, roster).map((e) => e.id)).toEqual(["E1", "E2"]);
    expect(inScope(scope, "E1")).toBe(true);
    expect(inScope(scope, "E3")).toBe(false);
  });

  it("an اداري can be scoped to several departments at once", () => {
    const scope = viewerScope(user({ role: "hr", departmentIds: ["D1", "D2"] }), roster);
    expect(scope.all).toBe(false);
    expect(employeesInScope(scope, roster).map((e) => e.id)).toEqual(["E1", "E2", "E3", "E4"]);
  });

  it("an employee sees only themselves", () => {
    const scope = viewerScope(user({ role: "employee", employeeId: "E3" }), roster);
    expect(employeesInScope(scope, roster).map((e) => e.id)).toEqual(["E3"]);
    expect(rowsInScope(scope, [{ employeeId: "E3" }, { employeeId: "E4" }])).toEqual([
      { employeeId: "E3" },
    ]);
  });

  it("an employee with no linked employee record sees nothing", () => {
    const scope = viewerScope(user({ role: "employee" }), roster);
    expect(employeesInScope(scope, roster)).toHaveLength(0);
    expect(inScope(scope, "E1")).toBe(false);
  });
});
