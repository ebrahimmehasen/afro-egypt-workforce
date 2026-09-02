"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nextId } from "@/lib/id";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

const allowanceSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["transport", "meal", "fixed", "incentive", "bonus"]),
  amount: z.coerce.number().positive(),
  notes: z.string().optional(),
});

export async function createAllowance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = allowanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  await prisma.allowance.create({
    data: {
      id: nextId("ALW"),
      employeeId: parsed.data.employeeId,
      type: parsed.data.type,
      amount: Math.round(parsed.data.amount),
      notes: parsed.data.notes,
      monthly: true,
    },
  });
  revalidatePath("/deductions");
  revalidatePath("/dashboard");
  return { success: true, message: t.deductions.submittedAllowance };
}

export async function deleteAllowance(id: string) {
  const t = await getT();
  const existing = await prisma.allowance.findUnique({ where: { id } });
  if (!existing) return { error: t.validation.notFound };
  await prisma.allowance.delete({ where: { id } });
  revalidatePath("/deductions");
  return { success: true };
}
