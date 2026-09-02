"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/data";
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
  const db = getDb();
  const user = await getSession();
  const id = nextId("DEP");
  db.departments.push({ id, ...parsed.data });
  addAuditLog({
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
  const db = getDb();
  const dept = db.departments.find((d) => d.id === id);
  if (!dept) return { error: t.validation.departmentNotFound };
  Object.assign(dept, parsed.data);
  revalidatePath("/departments");
  return { success: true, message: t.departments.savedEdits };
}

export async function deleteDepartment(id: string) {
  const t = await getT();
  const db = getDb();
  const inUse = db.employees.some((e) => e.departmentId === id);
  if (inUse) return { error: t.validation.departmentInUse };
  const idx = db.departments.findIndex((d) => d.id === id);
  if (idx === -1) return { error: t.validation.departmentNotFound };
  db.departments.splice(idx, 1);
  revalidatePath("/departments");
  return { success: true };
}
