"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/data";
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
  const db = getDb();
  db.shifts.push({ id: nextId("SHIFT"), ...parsed.data });
  revalidatePath("/shifts");
  return { success: true, message: t.shifts.saved };
}

export async function updateShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  const raw = Object.fromEntries(formData);
  const parsed = shiftSchema.safeParse({ ...raw, allowOvertime: formData.get("allowOvertime") === "on" });
  if (!parsed.success) return { error: t.validation.invalidData };
  const db = getDb();
  const shift = db.shifts.find((s) => s.id === id);
  if (!shift) return { error: t.validation.shiftNotFound };
  Object.assign(shift, parsed.data);
  revalidatePath("/shifts");
  return { success: true, message: t.shifts.savedEdits };
}
