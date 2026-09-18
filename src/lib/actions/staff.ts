"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

/**
 * Quick "اداري" account creation, reachable by anyone who manages employees
 * (admin or an hr/supervisor granted the "employees" permission) — not just
 * true admins. Unlike createUser (admin-only, full role picker), this always
 * starts with an empty `permissions` list AND an empty `departmentIds` list:
 * an admin must visit /permissions to grant access and pick which department(s)
 * (one, several, or none = company-wide) this account is scoped to.
 */
async function guard() {
  const user = await getSession();
  if (!user) return null;
  if (user.role === "admin" || hasPermission(user, "employees")) return user;
  return null;
}

const clean = (v?: string) => (v && v !== "none" ? v : null);

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  employeeId: z.string().optional(),
});

export async function createStaffAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { name, email, password, employeeId } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return { error: t.users.emailTaken };

  const passwordHash = await bcrypt.hash(password, 10);

  const created = await recordChange(
    {
      module: t.nav.permissions,
      action: t.users.auditCreate,
      newValue: `${name} <${email}> — ${t.users.staffAccount}`,
    },
    (tx) =>
      tx.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          passwordHash,
          role: "hr",
          employeeId: clean(employeeId),
          permissions: [],
          departmentIds: [],
        },
      }),
  );

  revalidatePath("/employees");
  revalidatePath("/permissions");
  revalidatePath("/users");

  if (actor.role === "admin") {
    redirect(`/permissions?u=${created.id}`);
  }
  return { success: true, message: t.users.staffAccountCreatedPendingPermissions };
}
