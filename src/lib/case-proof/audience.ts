import type { User } from "@/lib/types";

// Pure on purpose (no database): the navigation rule in permissions.ts, which the middleware also loads, uses it.

/**
 * Who may use case proof: the system admin (the manager), and a department supervisor, nobody else. HR, a regular employee,
 * a staff account: no access at all, not even a menu entry (the page, the routes and every action check this on the server).
 *
 * A supervisor's reach is the departments listed on his account (`departmentIds`, the field that already exists), and only
 * those. Unlike the general `viewerScope`, an EMPTY list does not mean "the whole company" here, and a supervisor with no page
 * grants is not narrowed to himself: a supervisor with no department listed has no case-proof access, and this tool never
 * widens anyone's reach. How an account maps to the departments it manages is a separate, still-pending decision.
 */
export function canUseCaseProof(user: Pick<User, "role" | "departmentIds">): boolean {
  if (user.role === "admin") return true;
  return user.role === "supervisor" && (user.departmentIds?.length ?? 0) > 0;
}

/** The departments this user may create and see cases for: `null` is every department (the admin). */
export function caseProofDepartments(user: Pick<User, "role" | "departmentIds">): string[] | null {
  if (user.role === "admin") return null;
  return canUseCaseProof(user) ? [...(user.departmentIds ?? [])] : [];
}

/** May this user touch a case about someone in this department? (Pure, for rows already loaded.) */
export function canUseDepartment(user: Pick<User, "role" | "departmentIds">, departmentId: string): boolean {
  if (!canUseCaseProof(user)) return false;
  const departments = caseProofDepartments(user);
  return departments === null || departments.includes(departmentId);
}
