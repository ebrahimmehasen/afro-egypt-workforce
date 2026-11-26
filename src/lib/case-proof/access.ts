import { prisma } from "@/lib/prisma";
import type { User } from "@/lib/types";
import { canUseCaseProof, canUseDepartment, caseProofDepartments } from "@/lib/case-proof/audience";

export { canUseCaseProof, caseProofDepartments, canUseDepartment } from "@/lib/case-proof/audience";

export interface PickedEmployee {
  id: string;
  name: string;
  employeeNumber: string;
  departmentId: string;
  departmentName: string;
}

/**
 * May this user attach a case to ALL of these employees? Every one must exist and be inside the user's departments (the admin:
 * any). If a single one is outside, or unknown, the whole request is refused: nothing is created for the others.
 */
export async function canUseEmployees(user: User, employeeIds: string[]): Promise<{ ok: true; employees: PickedEmployee[] } | { ok: false }> {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!canUseCaseProof(user) || ids.length === 0) return { ok: false };
  const rows = await prisma.employee.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, employeeNumber: true, departmentId: true, department: { select: { name: true } } },
  });
  if (rows.length !== ids.length || rows.some((e) => !canUseDepartment(user, e.departmentId))) return { ok: false };
  // keep the order the user picked them in
  return { ok: true, employees: ids.map((id) => rows.find((r) => r.id === id)!).map((e) => ({ id: e.id, name: e.name, employeeNumber: e.employeeNumber, departmentId: e.departmentId, departmentName: e.department.name })) };
}

/** The employees a user may pick from (their departments, active, not archived-out). */
export async function employeesForCaseProof(user: User) {
  const departments = caseProofDepartments(user);
  if (departments !== null && departments.length === 0) return [];
  return prisma.employee.findMany({
    where: { deletedAt: null, status: "active", ...(departments === null ? {} : { departmentId: { in: departments } }) },
    select: { id: true, name: true, employeeNumber: true, departmentId: true },
    orderBy: { name: "asc" },
  });
}
