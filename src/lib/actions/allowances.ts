"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nextId } from "@/lib/id";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

const allowanceSchema = z
  .object({
    employeeId: z.string().min(1),
    type: z.enum(["transport", "meal", "fixed", "incentive", "bonus"]),
    amount: z.coerce.number().positive(),
    effectiveYear: z.coerce.number().int().min(2020).max(2100).optional(),
    effectiveMonth: z.coerce.number().int().min(1).max(12).optional(),
    notes: z.string().optional(),
  })
  // a bonus is paid once — it needs a target month
  .refine((d) => d.type !== "bonus" || (d.effectiveYear && d.effectiveMonth), {
    path: ["effectiveMonth"],
    message: "bonus needs a target month",
  });

export async function createAllowance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = allowanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { type, effectiveYear, effectiveMonth } = parsed.data;
  const oneOff = type === "bonus";

  await prisma.allowance.create({
    data: {
      id: nextId("ALW"),
      employeeId: parsed.data.employeeId,
      type,
      amount: Math.round(parsed.data.amount),
      notes: parsed.data.notes,
      monthly: !oneOff,
      effectiveYear: oneOff ? effectiveYear ?? null : null,
      effectiveMonth: oneOff ? effectiveMonth ?? null : null,
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
