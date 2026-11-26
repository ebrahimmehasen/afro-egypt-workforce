import { prisma } from "@/lib/prisma";
import type { User } from "@/lib/types";
import { canUseCaseProof, canUseDepartment, caseProofDepartments } from "@/lib/case-proof/audience";

export { canUseCaseProof, caseProofDepartments, canUseDepartment } from "@/lib/case-proof/audience";

/** May this user create a case about this employee? Looks the employee's department up. */
export async function canUseEmployee(user: User, employeeId: string): Promise<{ ok: true; departmentId: string; name: string } | { ok: false }> {
  if (!canUseCaseProof(user)) return { ok: false };
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { departmentId: true, name: true } });
  if (!employee || !canUseDepartment(user, employee.departmentId)) return { ok: false };
  return { ok: true, departmentId: employee.departmentId, name: employee.name };
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
