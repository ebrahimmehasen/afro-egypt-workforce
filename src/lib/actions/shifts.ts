"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ActionState } from "@/hooks/use-action-feedback";
import { nextId } from "@/lib/id";
import { getT } from "@/lib/i18n";

const shiftSchema = z.object({
  name: z.string().min(2),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  gracePeriodMinutes: z.coerce.number().min(0),
  allowOvertime: z.coerce.boolean(),
  workDays: z
    .string()
    .transform((v) => v.split(",").filter(Boolean).map(Number)),
});

export async function createShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const raw = Object.fromEntries(formData);
  const parsed = shiftSchema.safeParse({ ...raw, allowOvertime: formData.get("allowOvertime") === "on" });
  if (!parsed.success) return { error: t.validation.invalidData };
  await prisma.shift.create({ data: { id: nextId("SHIFT"), ...parsed.data } });
  revalidatePath("/shifts");
  return { success: true, message: t.shifts.saved };
}

export async function updateShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  const raw = Object.fromEntries(formData);
  const parsed = shiftSchema.safeParse({ ...raw, allowOvertime: formData.get("allowOvertime") === "on" });
  if (!parsed.success) return { error: t.validation.invalidData };
  const shift = await prisma.shift.findFirst({ where: { id, deletedAt: null } });
  if (!shift) return { error: t.validation.shiftNotFound };
  await prisma.shift.update({ where: { id }, data: parsed.data });
  revalidatePath("/shifts");
  return { success: true, message: t.shifts.savedEdits };
}
