import { Employee, User } from "@/lib/types";
import { Store } from "@/lib/store";

/**
 * Row-level visibility — the single seam for "what may this user see?".
 *
 * `{ all: true }`  → the whole company (admin / hr).
 * `{ all: false }` → only employees whose id is in `ids` (a supervisor sees
 *                    their department, an employee sees only themselves, any
 *                    other role sees nothing).
 *
 * Every read entry point takes a `Scope` as its first argument, so a scoped
 * read cannot be forgotten. Build one with `viewerScope(user, employees)`.
 */
export type Scope = { all: true } | { all: false; ids: ReadonlySet<string> };

export function viewerScope(user: User, allEmployees: Employee[]): Scope {
  if (user.role === "admin" || user.role === "hr") return { all: true };
  if (user.role === "supervisor" && user.departmentId) {
    const ids = allEmployees
      .filter((e) => e.departmentId === user.departmentId)
      .map((e) => e.id);
    return { all: false, ids: new Set(ids) };
  }
  if (user.role === "employee" && user.employeeId) {
    return { all: false, ids: new Set([user.employeeId]) };
  }
  return { all: false, ids: new Set() };
}

export function inScope(scope: Scope, employeeId: string): boolean {
  return scope.all || scope.ids.has(employeeId);
}

/** Narrow an employee list to the scope. */
export function employeesInScope(scope: Scope, employees: Employee[]): Employee[] {
  return scope.all ? employees : employees.filter((e) => scope.ids.has(e.id));
}

/** Narrow any list of employee-keyed rows to the scope. */
export function rowsInScope<T extends { employeeId: string }>(scope: Scope, rows: T[]): T[] {
  return scope.all ? rows : rows.filter((r) => scope.ids.has(r.employeeId));
}

/** A read-model snapshot with every employee-keyed collection narrowed to the scope. */
export function scopedSnapshot(scope: Scope, db: Store): Store {
  if (scope.all) return db;
  return {
    ...db,
    employees: employeesInScope(scope, db.employees),
    dailyAttendance: rowsInScope(scope, db.dailyAttendance),
    leaves: rowsInScope(scope, db.leaves),
    overtime: rowsInScope(scope, db.overtime),
    deductions: rowsInScope(scope, db.deductions),
    allowances: rowsInScope(scope, db.allowances),
    payrollRecords: rowsInScope(scope, db.payrollRecords),
  };
}
