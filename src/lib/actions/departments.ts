"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { ActionState } from "@/hooks/use-action-feedback";
import { nextId } from "@/lib/id";
import { getT } from "@/lib/i18n";

const departmentSchema = z.object({
  name: z.string().min(2),
  managerId: z.string().min(1),
});

/** The head must be a real, current employee — the form offers a list, this enforces it server-side. */
function activeEmployee(id: string) {
  return prisma.employee.findFirst({
    where: { id, deletedAt: null, status: { not: "terminated" } },
    select: { id: true, name: true },
  });
}

type DepartmentPayload = { id: string; name: string; managerId: string };

export async function createDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  if (!(await activeEmployee(parsed.data.managerId))) return { error: t.validation.managerRequired };
  const actor = await getSession();
  const payload = { id: nextId("DEP"), ...parsed.data };

  return gate(
    { actionKey: "departments.create", module: t.nav.departments, actionLabel: t.auditActions.addDepartment, summary: payload.name },
    payload,
    () => applyCreateDepartment(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCreateDepartment(payload: DepartmentPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const manager = await activeEmployee(payload.managerId);
  if (!manager) return { error: t.validation.managerRequired };
  await recordChangeAs(
    actorName,
    { module: t.nav.departments, action: t.auditActions.addDepartment, newValue: `${payload.name} — ${manager.name}` },
    (tx) => tx.department.create({ data: payload }),
  );
  revalidatePath("/departments");
  return { success: true, message: t.departments.saved };
}

export async function updateDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const manager = await activeEmployee(parsed.data.managerId);
  if (!manager) return { error: t.validation.managerRequired };
  const before = await prisma.department.findFirst({
    where: { id, deletedAt: null },
    include: { manager: { select: { name: true } } },
  });
  if (!before) return { error: t.validation.departmentNotFound };
  const actor = await getSession();
  const payload = { id, ...parsed.data };

  return gate(
    {
      actionKey: "departments.update",
      module: t.nav.departments,
      actionLabel: t.auditActions.editDepartment,
      summary: `${before.name} — ${before.manager?.name ?? "-"} → ${payload.name} — ${manager.name}`,
      targetId: id,
    },
    payload,
    () => applyUpdateDepartment(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyUpdateDepartment(payload: DepartmentPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const before = await prisma.department.findFirst({
    where: { id: payload.id, deletedAt: null },
    include: { manager: { select: { name: true } } },
  });
  if (!before) return { error: t.validation.departmentNotFound };
  const manager = await activeEmployee(payload.managerId);
  if (!manager) return { error: t.validation.managerRequired };
  await recordChangeAs(
    actorName,
    {
      module: t.nav.departments,
      action: t.auditActions.editDepartment,
      oldValue: `${before.name} — ${before.manager?.name ?? "-"}`,
      newValue: `${payload.name} — ${manager.name}`,
    },
    (tx) => tx.department.update({ where: { id: payload.id }, data: { name: payload.name, managerId: payload.managerId } }),
  );
  revalidatePath("/departments");
  return { success: true, message: t.departments.savedEdits };
}

/** Soft delete — blocked while any active employee is still in the department. */
export async function deleteDepartment(id: string): Promise<ActionState> {
  const t = await getT();
  const inUse = await prisma.employee.count({ where: { departmentId: id, deletedAt: null } });
  if (inUse > 0) return { error: t.validation.departmentInUse };
  const dept = await prisma.department.findFirst({ where: { id, deletedAt: null } });
  if (!dept) return { error: t.validation.departmentNotFound };
  const actor = await getSession();

  return gate(
    {
      actionKey: "departments.delete",
      module: t.nav.departments,
      actionLabel: t.auditActions.deleteDepartment,
      summary: `${dept.name} (${dept.id})`,
      targetId: id,
    },
    { id },
    () => applyDeleteDepartment({ id }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyDeleteDepartment(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const inUse = await prisma.employee.count({ where: { departmentId: payload.id, deletedAt: null } });
  if (inUse > 0) return { error: t.validation.departmentInUse };
  const dept = await prisma.department.findFirst({ where: { id: payload.id, deletedAt: null } });
  if (!dept) return { error: t.validation.departmentNotFound };
  await recordChangeAs(
    actorName,
    { module: t.nav.departments, action: t.auditActions.deleteDepartment, oldValue: `${dept.name} (${dept.id})` },
    (tx) => tx.department.update({ where: { id: payload.id }, data: { deletedAt: new Date() } }),
  );
  revalidatePath("/departments");
  return { success: true };
}
