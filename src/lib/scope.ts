import { Employee, User } from "@/lib/types";

/**
 * Row-level visibility. admin / hr see everyone; a supervisor sees only their
 * own department; an employee sees only themselves; anything else sees nothing.
 *
 * `null` means "no restriction" (see all).
 */
export function visibleEmployeeIds(user: User, allEmployees: Employee[]): string[] | null {
  if (user.role === "admin" || user.role === "hr") return null;
  if (user.role === "supervisor" && user.departmentId) {
    return allEmployees.filter((e) => e.departmentId === user.departmentId).map((e) => e.id);
  }
  if (user.role === "employee" && user.employeeId) return [user.employeeId];
  return [];
}

export function scopeEmployees(employees: Employee[], user: User): Employee[] {
  const ids = visibleEmployeeIds(user, employees);
  if (ids === null) return employees;
  const set = new Set(ids);
  return employees.filter((e) => set.has(e.id));
}

/** Filter any list of `{ employeeId }` rows down to what the user may see. */
export function scopeByEmployee<T extends { employeeId: string }>(
  rows: T[],
  user: User,
  allEmployees: Employee[],
): T[] {
  const ids = visibleEmployeeIds(user, allEmployees);
  if (ids === null) return rows;
  const set = new Set(ids);
  return rows.filter((r) => set.has(r.employeeId));
}

export function canSeeEmployee(user: User, employeeId: string, allEmployees: Employee[]): boolean {
  const ids = visibleEmployeeIds(user, allEmployees);
  return ids === null || ids.includes(employeeId);
}
