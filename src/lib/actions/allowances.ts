"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/data";
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
  const db = getDb();
  db.allowances.push({
    id: nextId("ALW"),
    ...parsed.data,
    monthly: true,
  });
  revalidatePath("/deductions");
  revalidatePath("/dashboard");
  return { success: true, message: t.deductions.submittedAllowance };
}

export async function deleteAllowance(id: string) {
  const t = await getT();
  const db = getDb();
  const idx = db.allowances.findIndex((a) => a.id === id);
  if (idx === -1) return { error: t.validation.notFound };
  db.allowances.splice(idx, 1);
  revalidatePath("/deductions");
  return { success: true };
}
