"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canManagePermissions, PERMISSION_KEYS } from "@/lib/permissions";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

async function guard() {
  const user = await getSession();
  if (!user || !canManagePermissions(user.role)) return null;
  return user;
}

const schema = z.object({
  id: z.string().min(1),
  active: z.coerce.boolean(),
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).default([]),
  departmentIds: z.array(z.string()).default([]),
});

/**
 * formData carries one checkbox per PERMISSION_KEYS entry (perm_<key>) and one
 * per department (dept_<id>) + active + id. An empty departmentIds selection
 * means company-wide scope (matches the old hr default).
 */
export async function updateUserPermissions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "on" || formData.get("active") === "true";
  const permissions = PERMISSION_KEYS.filter((k) => formData.get(`perm_${k}`) != null);
  const allDepartments = await prisma.department.findMany({ where: { deletedAt: null }, select: { id: true } });
  const departmentIds = allDepartments.map((d) => d.id).filter((depId) => formData.get(`dept_${depId}`) != null);

  const parsed = schema.safeParse({ id, active, permissions, departmentIds });
  if (!parsed.success) return { error: t.validation.invalidData };

  const target = await prisma.user.findUnique({ where: { id: parsed.data.id } });
  if (!target || (target.role !== "hr" && target.role !== "supervisor")) {
    return { error: t.validation.notFound };
  }

  const scopeLabel = (ids: string[]) => (ids.length === 0 ? t.common.allDepartments : ids.join(", "));

  await recordChange(
    {
      module: t.nav.permissions,
      action: t.users.auditUpdate,
      oldValue: `${target.name} — ${(target.permissions as string[] | null)?.join(", ") || "-"} — ${scopeLabel((target.departmentIds as string[] | null) ?? [])} — ${target.active ? t.users.active : t.users.inactive}`,
      newValue: `${target.name} — ${parsed.data.permissions.join(", ") || "-"} — ${scopeLabel(parsed.data.departmentIds)} — ${parsed.data.active ? t.users.active : t.users.inactive}`,
    },
    (tx) =>
      tx.user.update({
        where: { id: parsed.data.id },
        data: { permissions: parsed.data.permissions, departmentIds: parsed.data.departmentIds, active: parsed.data.active },
      }),
  );

  revalidatePath("/permissions");
  revalidatePath("/users");
  return { success: true, message: t.permissions.saved };
}
