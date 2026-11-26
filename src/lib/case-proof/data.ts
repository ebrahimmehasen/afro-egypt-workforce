import { prisma } from "@/lib/prisma";
import type { User } from "@/lib/types";
import { caseProofDepartments, canUseCaseProof } from "@/lib/case-proof/access";

// What the pages read. Every read is scoped by the employee's CURRENT department: a supervisor sees the cases of the people
// in the departments on his account, the admin sees all, nobody else sees any. (A case made in a department an employee has
// since left is visible to the supervisors of where he is now, not to the old one.)

const include = { employee: { select: { id: true, name: true, employeeNumber: true, departmentId: true, department: { select: { name: true } } } } } as const;

export async function loadCaseProofs(user: User, opts: { employeeId?: string; status?: "draft" | "saved" } = {}) {
  if (!canUseCaseProof(user)) return [];
  const departments = caseProofDepartments(user);
  return prisma.caseProof.findMany({
    where: {
      ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(departments === null ? {} : { employee: { departmentId: { in: departments } } }),
    },
    include,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

/** One case, only if this user may see it (otherwise null, the same as a case that does not exist). */
export async function loadCaseProof(user: User, id: string) {
  if (!canUseCaseProof(user)) return null;
  const row = await prisma.caseProof.findUnique({ where: { id }, include });
  if (!row) return null;
  const departments = caseProofDepartments(user);
  return departments === null || departments.includes(row.employee.departmentId) ? row : null;
}

/** Who may change a case's text: the admin, or the supervisor who made it (a co-supervisor only reads it). */
export const canEditCaseProof = (user: Pick<User, "id" | "role">, createdById: string) => user.role === "admin" || user.id === createdById;
