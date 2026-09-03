"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addAuditLog } from "@/lib/store";
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
  departmentId: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  role: roleEnum,
  active: z.coerce.boolean(),
  employeeId: z.string().optional(),
  departmentId: z.string().optional(),
});

const clean = (v?: string) => (v && v !== "none" ? v : null);

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { name, email, password, role, employeeId, departmentId } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return { error: t.users.emailTaken };

  await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      role,
      employeeId: clean(employeeId),
      departmentId: clean(departmentId),
    },
  });

  await addAuditLog({
    userName: actor.name,
    action: t.users.auditCreate,
    module: t.nav.users,
    oldValue: "-",
    newValue: `${name} <${email}> — ${role}`,
  });

  revalidatePath("/users");
  return { success: true, message: t.users.saved };
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { id, name, role, active, employeeId, departmentId } = parsed.data;

  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) return { error: t.validation.notFound };
  if (id === actor.id && (!active || role !== "admin")) return { error: t.users.cannotLockSelfOut };

  await prisma.user.update({
    where: { id },
    data: { name, role, active, employeeId: clean(employeeId), departmentId: clean(departmentId) },
  });

  await addAuditLog({
    userName: actor.name,
    action: t.users.auditUpdate,
    module: t.nav.users,
    oldValue: `${before.name} — ${before.role} — ${before.active ? t.users.active : t.users.inactive}`,
    newValue: `${name} — ${role} — ${active ? t.users.active : t.users.inactive}`,
  });

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

  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });

  await addAuditLog({
    userName: actor.name,
    action: t.users.auditResetPassword,
    module: t.nav.users,
    oldValue: "-",
    newValue: `${target.name} <${target.email}>`,
  });

  revalidatePath("/users");
  return { success: true, message: t.users.passwordReset };
}
