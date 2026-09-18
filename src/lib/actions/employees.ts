"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, TransactionClient } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { generateEmployeeNumber } from "@/lib/employee-number";

const employeeSchema = z
  .object({
    name: z.string().min(2),
    departmentId: z.string().min(1),
    jobTitle: z.string().min(1),
    hireDate: z.string().min(1),
    shiftId: z.string().min(1),
    salaryType: z.enum(["monthly", "daily"]).default("monthly"),
    basicSalary: z.coerce.number().min(0).default(0),
    dailyRate: z.coerce.number().min(0).optional(),
    dailyWorkingHours: z.coerce.number().positive().default(8),
    allowances: z.coerce.number().min(0).default(0),
    status: z.enum(["active", "on_leave", "terminated"]),
    phone: z.string().min(6),
    address: z.string().min(3),
    qualification: z.string().min(2),
    militaryStatus: z.enum(["completed", "exempted", "postponed", "not_applicable"]),
    nationalId: z.string().regex(/^\d{14}$/),
  })
  .refine((d) => (d.salaryType === "daily" ? (d.dailyRate ?? 0) > 0 : d.basicSalary > 0), {
    path: ["salaryType"],
    message: "salary amount required",
  });

type EmployeePayload = z.infer<typeof employeeSchema> & { id: string };

async function nextEmployeeId() {
  const rows = await prisma.employee.findMany({ select: { id: true } });
  const max = rows.reduce((m, e) => {
    const n = Number(e.id.replace("EMP-", ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1000);
  return `EMP-${max + 1}`;
}

export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const id = await nextEmployeeId();

  if (await prisma.employee.findUnique({ where: { nationalId: parsed.data.nationalId } })) {
    return { error: t.validation.nationalIdTaken };
  }

  const actor = await getSession();
  const payload: EmployeePayload = { id, ...parsed.data };

  return gate(
    {
      actionKey: "employees.create",
      module: t.nav.employees,
      actionLabel: t.auditActions.addEmployee,
      summary: payload.name,
    },
    payload,
    () => applyCreateEmployee(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCreateEmployee(payload: EmployeePayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  if (await prisma.employee.findUnique({ where: { nationalId: payload.nationalId } })) {
    return { error: t.validation.nationalIdTaken };
  }
  const { id, allowances, hireDate, dailyRate, salaryType, nationalId, ...rest } = payload;

  const department = await prisma.department.findUnique({ where: { id: rest.departmentId } });
  if (!department) return { error: t.validation.invalidData };

  await recordChangeAs(
    actorName,
    { module: t.nav.employees, action: t.auditActions.addEmployee, newValue: payload.name },
    async (tx) => {
      const employeeNumber = await generateEmployeeNumber(tx, department.name);
      return tx.employee.create({
        data: {
          id,
          employeeNumber,
          ...rest,
          nationalId,
          salaryType,
          dailyRate: salaryType === "daily" ? dailyRate ?? null : null,
          hireDate: new Date(`${hireDate}T00:00:00.000Z`),
          allowancesTotal: allowances,
        },
      });
    },
  );

  revalidatePath("/employees");
  return { success: true, message: t.employees.savedEmployee };
}

export async function updateEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!before) return { error: t.validation.employeeNotFound };

  const nidOwner = await prisma.employee.findUnique({ where: { nationalId: parsed.data.nationalId } });
  if (nidOwner && nidOwner.id !== id) return { error: t.validation.nationalIdTaken };

  const actor = await getSession();
  const payload: EmployeePayload = { id, ...parsed.data };

  return gate(
    {
      actionKey: "employees.update",
      module: t.nav.employees,
      actionLabel: t.auditActions.editEmployee,
      summary: `${before.name} — ${before.basicSalary} EGP → ${payload.name} — ${payload.basicSalary} EGP`,
      targetId: id,
    },
    payload,
    () => applyUpdateEmployee(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyUpdateEmployee(payload: EmployeePayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { id, allowances, hireDate, dailyRate, salaryType, nationalId, ...rest } = payload;

  const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!before) return { error: t.validation.employeeNotFound };
  const nidOwner = await prisma.employee.findUnique({ where: { nationalId } });
  if (nidOwner && nidOwner.id !== id) return { error: t.validation.nationalIdTaken };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.employees,
      action: t.auditActions.editEmployee,
      oldValue: `${before.name} — ${before.basicSalary} EGP`,
      newValue: `${payload.name} — ${payload.basicSalary} EGP`,
    },
    async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: {
          ...rest,
          nationalId,
          salaryType,
          dailyRate: salaryType === "daily" ? dailyRate ?? null : null,
          hireDate: new Date(`${hireDate}T00:00:00.000Z`),
          allowancesTotal: allowances,
        },
      });
      await freezeLinkedAccountIfInactive(tx, id, updated.status);
      return updated;
    },
  );

  revalidatePath("/employees");
  revalidatePath(`/employees/${before.employeeNumber}`);
  return { success: true, message: t.employees.savedEdits };
}

/**
 * terminated freezes any linked login (User.active = false) so
 * permissions/access stop immediately — reactivating the employee later does
 * NOT auto-restore login access, an admin must re-enable it explicitly.
 */
async function freezeLinkedAccountIfInactive(
  tx: TransactionClient,
  employeeId: string,
  status: string,
) {
  if (status !== "terminated") return;
  await tx.user.updateMany({ where: { employeeId, active: true }, data: { active: false } });
}

/** Soft delete — the employee is archived (deletedAt set), not physically removed. */
export async function deleteEmployee(id: string): Promise<ActionState> {
  const t = await getT();
  const removed = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!removed) return { error: t.validation.employeeNotFound };
  const actor = await getSession();

  return gate(
    {
      actionKey: "employees.delete",
      module: t.nav.employees,
      actionLabel: t.auditActions.deleteEmployee,
      summary: `${removed.name} (${removed.employeeNumber})`,
      targetId: id,
    },
    { id },
    () => applyDeleteEmployee({ id }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyDeleteEmployee(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const removed = await prisma.employee.findFirst({ where: { id: payload.id, deletedAt: null } });
  if (!removed) return { error: t.validation.employeeNotFound };

  await recordChangeAs(
    actorName,
    { module: t.nav.employees, action: t.auditActions.deleteEmployee, oldValue: `${removed.name} (${removed.employeeNumber})` },
    async (tx) => {
      const updated = await tx.employee.update({ where: { id: payload.id }, data: { deletedAt: new Date(), status: "terminated" } });
      await freezeLinkedAccountIfInactive(tx, payload.id, updated.status);
      return updated;
    },
  );

  revalidatePath("/employees");
  return { success: true };
}
