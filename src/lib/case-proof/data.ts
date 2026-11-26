import { prisma } from "@/lib/prisma";
import type { User } from "@/lib/types";
import { canUseDepartment, caseProofDepartments, canUseCaseProof } from "@/lib/case-proof/audience";

// What the pages read. A case can be about one employee or a group (the CaseProofEmployee rows). It is visible to the admin, and
// to a supervisor when at least one employee it is attached to is in a department on his account (by the employee's CURRENT
// department). A supervisor is shown only the linked employees inside his own departments, never the others' names. Nobody
// else, HR included, sees any case.

const employeeSelect = { id: true, name: true, employeeNumber: true, departmentId: true, department: { select: { name: true } } } as const;
const include = { links: { include: { employee: { select: employeeSelect } } } } as const;

type Row = Awaited<ReturnType<typeof prisma.caseProof.findMany<{ include: typeof include }>>>[number];
export type CaseEmployee = { id: string; name: string; employeeNumber: string; departmentId: string; departmentName: string };
export type VisibleCase = Omit<Row, "links"> & { employees: CaseEmployee[] };

/** The linked employees this user may see (all for the admin, only his departments' for a supervisor). */
function shape(user: User, row: Row): VisibleCase {
  const { links, ...rest } = row;
  const employees = links
    .map((l) => ({ id: l.employee.id, name: l.employee.name, employeeNumber: l.employee.employeeNumber, departmentId: l.employee.departmentId, departmentName: l.employee.department.name }))
    .filter((e) => canUseDepartment(user, e.departmentId))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...rest, employees };
}

const visibleWhere = (user: User) => {
  const departments = caseProofDepartments(user);
  return departments === null ? {} : { links: { some: { employee: { departmentId: { in: departments } } } } };
};

export async function loadCaseProofs(user: User, opts: { employeeId?: string; status?: "draft" | "saved" } = {}): Promise<VisibleCase[]> {
  if (!canUseCaseProof(user)) return [];
  const rows = await prisma.caseProof.findMany({
    where: {
      ...visibleWhere(user),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.employeeId ? { links: { some: { employeeId: opts.employeeId, ...(caseProofDepartments(user) === null ? {} : { employee: { departmentId: { in: caseProofDepartments(user)! } } }) } } } : {}),
    },
    include,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return rows.map((r) => shape(user, r));
}

/** One case, only if this user may see it (otherwise null, the same as a case that does not exist). */
export async function loadCaseProof(user: User, id: string): Promise<VisibleCase | null> {
  if (!canUseCaseProof(user)) return null;
  const row = await prisma.caseProof.findFirst({ where: { id, ...visibleWhere(user) }, include });
  return row ? shape(user, row) : null;
}

/**
 * The case-proof tab of one employee's profile: shown to the admin and to the supervisor of the employee's department, and
 * absent (no tab, no data) for HR, an employee, and everyone else. `employeeId` is the employee's database id (the profile
 * route is /employees/[id] with that id, not the EMP code). Saved cases only, including group cases the employee is part of.
 */
export async function loadEmployeeCaseProofTab(user: User, employee: { id: string; departmentId: string }): Promise<{ show: boolean; cases: VisibleCase[] }> {
  if (!canUseDepartment(user, employee.departmentId)) return { show: false, cases: [] };
  return { show: true, cases: await loadCaseProofs(user, { employeeId: employee.id, status: "saved" }) };
}

/** Who may change a case's text: the admin, or the supervisor who made it (a co-supervisor only reads it). */
export const canEditCaseProof = (user: Pick<User, "id" | "role">, createdById: string) => user.role === "admin" || user.id === createdById;
