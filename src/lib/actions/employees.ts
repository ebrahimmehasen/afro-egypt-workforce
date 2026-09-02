"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/data";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
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

function nextEmployeeId() {
  const db = getDb();
  const max = db.employees.reduce((m, e) => {
    const n = Number(e.id.replace("EMP-", ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1000);
  return `EMP-${max + 1}`;
}

export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = getT();
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const db = getDb();
  const user = getSession();
  const id = nextEmployeeId();
  db.employees.push({ id, ...parsed.data });

  addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.addEmployee,
    module: t.nav.employees,
    oldValue: "-",
    newValue: `${parsed.data.name} (${id})`,
  });

  revalidatePath("/employees");
  return { success: true, message: t.employees.savedEmployee };
}

export async function updateEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = getT();
  const id = String(formData.get("id") ?? "");
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const db = getDb();
  const user = getSession();
  const idx = db.employees.findIndex((e) => e.id === id);
  if (idx === -1) return { error: t.validation.employeeNotFound };

  const before = db.employees[idx];
  db.employees[idx] = { ...before, ...parsed.data };

  addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.editEmployee,
    module: t.nav.employees,
    oldValue: `${before.name} — ${before.basicSalary} EGP`,
    newValue: `${parsed.data.name} — ${parsed.data.basicSalary} EGP`,
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  return { success: true, message: t.employees.savedEdits };
}

export async function deleteEmployee(id: string) {
  const t = getT();
  const db = getDb();
  const user = getSession();
  const idx = db.employees.findIndex((e) => e.id === id);
  if (idx === -1) return { error: t.validation.employeeNotFound };
  const [removed] = db.employees.splice(idx, 1);

  addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.deleteEmployee,
    module: t.nav.employees,
    oldValue: `${removed.name} (${removed.id})`,
    newValue: "-",
  });

  revalidatePath("/employees");
  return { success: true };
}
