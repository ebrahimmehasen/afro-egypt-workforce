"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
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

type ShiftPayload = z.infer<typeof shiftSchema> & { id: string };

export async function createShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const raw = Object.fromEntries(formData);
  const parsed = shiftSchema.safeParse({ ...raw, allowOvertime: formData.get("allowOvertime") === "on" });
  if (!parsed.success) return { error: t.validation.invalidData };
  const actor = await getSession();
  const payload: ShiftPayload = { id: nextId("SHIFT"), ...parsed.data };

  return gate(
    { actionKey: "shifts.create", module: t.nav.shifts, actionLabel: t.auditActions.addShift, summary: payload.name },
    payload,
    () => applyCreateShift(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCreateShift(payload: ShiftPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { id, ...rest } = payload;
  await recordChangeAs(
    actorName,
    { module: t.nav.shifts, action: t.auditActions.addShift, newValue: payload.name },
    (tx) => tx.shift.create({ data: { id, ...rest } }),
  );
  revalidatePath("/shifts");
  return { success: true, message: t.shifts.saved };
}

export async function updateShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  const raw = Object.fromEntries(formData);
  const parsed = shiftSchema.safeParse({ ...raw, allowOvertime: formData.get("allowOvertime") === "on" });
  if (!parsed.success) return { error: t.validation.invalidData };
  const before = await prisma.shift.findFirst({ where: { id, deletedAt: null } });
  if (!before) return { error: t.validation.shiftNotFound };
  const actor = await getSession();
  const payload: ShiftPayload = { id, ...parsed.data };

  return gate(
    {
      actionKey: "shifts.update",
      module: t.nav.shifts,
      actionLabel: t.auditActions.editShift,
      summary: `${before.name} → ${payload.name}`,
      targetId: id,
    },
    payload,
    () => applyUpdateShift(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyUpdateShift(payload: ShiftPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { id, ...rest } = payload;
  const before = await prisma.shift.findFirst({ where: { id, deletedAt: null } });
  if (!before) return { error: t.validation.shiftNotFound };
  await recordChangeAs(
    actorName,
    { module: t.nav.shifts, action: t.auditActions.editShift, oldValue: before.name, newValue: payload.name },
    (tx) => tx.shift.update({ where: { id }, data: rest }),
  );
  revalidatePath("/shifts");
  return { success: true, message: t.shifts.savedEdits };
}
