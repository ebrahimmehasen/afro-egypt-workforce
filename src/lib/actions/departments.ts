"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { ActionState } from "@/hooks/use-action-feedback";
import { nextId } from "@/lib/id";
import { getT } from "@/lib/i18n";

const departmentSchema = z.object({
  name: z.string().min(2),
  managerName: z.string().min(2),
});

export async function createDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const user = await getSession();
  await prisma.department.create({ data: { id: nextId("DEP"), ...parsed.data } });
  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.addDepartment,
    module: t.nav.departments,
    oldValue: "-",
    newValue: parsed.data.name,
  });
  revalidatePath("/departments");
  return { success: true, message: t.departments.saved };
}

export async function updateDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const dept = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!dept) return { error: t.validation.departmentNotFound };
  await prisma.department.update({ where: { id }, data: parsed.data });
  revalidatePath("/departments");
  return { success: true, message: t.departments.savedEdits };
}

/** Soft delete — blocked while any active employee is still in the department. */
export async function deleteDepartment(id: string) {
  const t = await getT();
  const inUse = await prisma.employee.count({ where: { departmentId: id, deletedAt: null } });
  if (inUse > 0) return { error: t.validation.departmentInUse };
  const dept = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!dept) return { error: t.validation.departmentNotFound };
  await prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/departments");
  return { success: true };
}
