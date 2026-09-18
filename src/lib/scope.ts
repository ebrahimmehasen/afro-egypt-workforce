import { Employee, User } from "@/lib/types";
import { isSelfService } from "@/lib/permissions";
import { Store } from "@/lib/store";
import { prisma } from "@/lib/prisma";

/**
 * Row-level visibility — the single seam for "what may this user see?".
 *
 * `{ all: true }`  → the whole company (admin / hr).
 * `{ all: false }` → only employees whose id is in `ids` (a department-scoped
 *                    account sees its departments, a self-service account —
 *                    employee, or staff with no grants — sees only themselves).
 *
 * Every read entry point takes a `Scope` as its first argument, so a scoped
 * read cannot be forgotten. Build one with `viewerScope(user, employees)`.
 */
export type Scope = { all: true } | { all: false; ids: ReadonlySet<string> };

export function viewerScope(user: User, allEmployees: Pick<Employee, "id" | "departmentId">[]): Scope {
  if (user.role === "admin") return { all: true };
  if (isSelfService(user)) {
    return user.employeeId ? { all: false, ids: new Set([user.employeeId]) } : { all: false, ids: new Set() };
  }
  // hr/supervisor "اداري" — scoped by the free department list an admin granted
  // via /permissions; an empty list means company-wide (the old hr default).
  const departmentIds = user.departmentIds ?? [];
  if (departmentIds.length === 0) return { all: true };
  const deptSet = new Set(departmentIds);
  const ids = allEmployees.filter((e) => deptSet.has(e.departmentId)).map((e) => e.id);
  return { all: false, ids: new Set(ids) };
}

export function inScope(scope: Scope, employeeId: string): boolean {
  return scope.all || scope.ids.has(employeeId);
}

/**
 * Same rule as `viewerScope`, for a single employee id, without loading the
 * whole roster — for API routes (e.g. serving an uploaded file) that only
 * ever need one yes/no answer. Only hits the database when the caller is a
 * supervisor (to read the target's department).
 */
export async function canViewEmployee(user: User, employeeId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  if (isSelfService(user)) return user.employeeId === employeeId;
  const departmentIds = user.departmentIds ?? [];
  if (departmentIds.length === 0) return true; // company-wide اداري
  const target = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { departmentId: true },
  });
  return target != null && departmentIds.includes(target.departmentId);
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
    employeeDocuments: rowsInScope(scope, db.employeeDocuments),
    employeeAcknowledgments: rowsInScope(scope, db.employeeAcknowledgments),
  };
}
