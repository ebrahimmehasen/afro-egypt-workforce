"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

async function guard() {
  const user = await getSession();
  if (!user || !canManageUsers(user.role)) return null;
  return user;
}

const roleEnum = z.enum(["admin", "hr", "supervisor", "employee"]);

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: roleEnum,
  employeeId: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  role: roleEnum,
  active: z.coerce.boolean(),
  employeeId: z.string().optional(),
});

const clean = (v?: string) => (v && v !== "none" ? v : null);

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { name, email, password, role } = parsed.data;
  const employeeId = clean(parsed.data.employeeId);

  // Every non-admin account is made from an existing employee record.
  if (role !== "admin" && !employeeId) return { error: t.users.employeeRequired };
  if (employeeId) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) return { error: t.validation.employeeNotFound };
    if (await prisma.user.findFirst({ where: { employeeId } })) return { error: t.users.employeeHasUser };
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return { error: t.users.emailTaken };

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await recordChange(
    {
      module: t.nav.users,
      action: t.users.auditCreate,
      newValue: `${name} <${email}> — ${role}`,
    },
    (tx) =>
      tx.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          passwordHash,
          role,
          employeeId,
          permissions: [], // granted from /permissions right after creation (n/a for role=admin/employee)
          departmentIds: [],
        },
      }),
  );

  revalidatePath("/users");
  revalidatePath("/permissions");
  // hr/supervisor start with zero access — send the admin straight to set it.
  if (role === "hr" || role === "supervisor") redirect(`/permissions?u=${created.id}`);
  return { success: true, message: t.users.saved };
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { id, name, role, active, employeeId } = parsed.data;

  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) return { error: t.validation.notFound };
  if (id === actor.id && (!active || role !== "admin")) return { error: t.users.cannotLockSelfOut };

  await recordChange(
    {
      module: t.nav.users,
      action: t.users.auditUpdate,
      oldValue: `${before.name} — ${before.role} — ${before.active ? t.users.active : t.users.inactive}`,
      newValue: `${name} — ${role} — ${active ? t.users.active : t.users.inactive}`,
    },
    (tx) =>
      tx.user.update({
        where: { id },
        data: { name, role, active, employeeId: clean(employeeId) },
      }),
  );

  revalidatePath("/users");
  return { success: true, message: t.users.saved };
}

export async function resetUserPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: t.validation.invalidData };

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return { error: t.validation.notFound };

  const passwordHash = await bcrypt.hash(password, 10);
  await recordChange(
    {
      module: t.nav.users,
      action: t.users.auditResetPassword,
      newValue: `${target.name} <${target.email}>`,
    },
    (tx) => tx.user.update({ where: { id }, data: { passwordHash } }),
  );

  revalidatePath("/users");
  return { success: true, message: t.users.passwordReset };
}
