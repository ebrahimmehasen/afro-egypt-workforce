"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { nextId } from "@/lib/id";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { deductionTypeLabel } from "@/lib/i18n/labels";

const deductionSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["late", "absence", "early_leave", "penalty", "advance", "admin_deduction", "other"]),
  amount: z.coerce.number().positive(),
  date: z.string().min(1),
  reason: z.string().min(3),
  notes: z.string().optional(),
});

export async function createDeduction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = deductionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const user = await getSession();
  await prisma.deduction.create({
    data: {
      id: nextId("DED"),
      employeeId: parsed.data.employeeId,
      type: parsed.data.type,
      amount: Math.round(parsed.data.amount),
      date: new Date(`${parsed.data.date}T00:00:00.000Z`),
      reason: parsed.data.reason,
      notes: parsed.data.notes,
    },
  });

  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.addDeduction,
    module: t.nav.deductions,
    oldValue: "-",
    newValue: `${deductionTypeLabel(parsed.data.type, t)} — ${parsed.data.amount} EGP`,
    reason: parsed.data.reason,
  });

  revalidatePath("/deductions");
  revalidatePath("/dashboard");
  return { success: true, message: t.deductions.submittedDeduction };
}

export async function deleteDeduction(id: string) {
  const t = await getT();
  const existing = await prisma.deduction.findUnique({ where: { id } });
  if (!existing) return { error: t.validation.notFound };
  await prisma.deduction.delete({ where: { id } });
  revalidatePath("/deductions");
  return { success: true };
}
