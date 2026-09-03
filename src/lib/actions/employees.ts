"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChange } from "@/lib/audit";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

const employeeSchema = z.object({
  name: z.string().min(2),
  departmentId: z.string().min(1),
  jobTitle: z.string().min(1),
  hireDate: z.string().min(1),
  shiftId: z.string().min(1),
  basicSalary: z.coerce.number().positive(),
  allowances: z.coerce.number().min(0).default(0),
  biometricDeviceUserId: z.string().min(1),
  status: z.enum(["active", "on_leave", "suspended", "terminated"]),
});

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
  const { allowances, hireDate, ...rest } = parsed.data;

  await recordChange(
    {
      module: t.nav.employees,
      action: t.auditActions.addEmployee,
      newValue: `${parsed.data.name} (${id})`,
    },
    (tx) =>
      tx.employee.create({
        data: {
          id,
          ...rest,
          hireDate: new Date(`${hireDate}T00:00:00.000Z`),
          allowancesTotal: allowances,
        },
      }),
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

  const { allowances, hireDate, ...rest } = parsed.data;
  await recordChange(
    {
      module: t.nav.employees,
      action: t.auditActions.editEmployee,
      oldValue: `${before.name} — ${before.basicSalary} EGP`,
      newValue: `${parsed.data.name} — ${parsed.data.basicSalary} EGP`,
    },
    (tx) =>
      tx.employee.update({
        where: { id },
        data: {
          ...rest,
          hireDate: new Date(`${hireDate}T00:00:00.000Z`),
          allowancesTotal: allowances,
        },
      }),
  );

  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  return { success: true, message: t.employees.savedEdits };
}

/** Soft delete — the employee is archived (deletedAt set), not physically removed. */
export async function deleteEmployee(id: string) {
  const t = await getT();
  const removed = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!removed) return { error: t.validation.employeeNotFound };

  await recordChange(
    {
      module: t.nav.employees,
      action: t.auditActions.deleteEmployee,
      oldValue: `${removed.name} (${removed.id})`,
    },
    (tx) => tx.employee.update({ where: { id }, data: { deletedAt: new Date(), status: "terminated" } }),
  );

  revalidatePath("/employees");
  return { success: true };
}
