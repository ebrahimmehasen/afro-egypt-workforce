import { describe, expect, it } from "vitest";
import { employeesInScope, inScope, rowsInScope, viewerScope } from "@/lib/scope";
import type { Employee, User } from "@/lib/types";

const emp = (id: string, departmentId: string): Employee => ({
  id,
  name: id,
  departmentId,
  jobTitle: "worker",
  hireDate: "2026-01-01",
  shiftId: "SHIFT-1",
  basicSalary: 5000,
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
  it("admin and hr see the whole company", () => {
    for (const role of ["admin", "hr"] as const) {
      const scope = viewerScope(user({ role }), roster);
      expect(scope.all).toBe(true);
      expect(employeesInScope(scope, roster)).toHaveLength(4);
    }
  });

  it("a supervisor sees only their department", () => {
    const scope = viewerScope(user({ role: "supervisor", departmentId: "D1" }), roster);
    expect(scope.all).toBe(false);
    expect(employeesInScope(scope, roster).map((e) => e.id)).toEqual(["E1", "E2"]);
    expect(inScope(scope, "E1")).toBe(true);
    expect(inScope(scope, "E3")).toBe(false);
  });

  it("an employee sees only themselves", () => {
    const scope = viewerScope(user({ role: "employee", employeeId: "E3" }), roster);
    expect(employeesInScope(scope, roster).map((e) => e.id)).toEqual(["E3"]);
    expect(rowsInScope(scope, [{ employeeId: "E3" }, { employeeId: "E4" }])).toEqual([
      { employeeId: "E3" },
    ]);
  });

  it("a role with no linked department / employee sees nothing", () => {
    const scope = viewerScope(user({ role: "supervisor" }), roster);
    expect(employeesInScope(scope, roster)).toHaveLength(0);
    expect(inScope(scope, "E1")).toBe(false);
  });
});
