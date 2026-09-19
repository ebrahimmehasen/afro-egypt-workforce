"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
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

type DeductionPayload = z.infer<typeof deductionSchema> & { id: string };

export async function createDeduction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = deductionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const actor = await getSession();
  const payload: DeductionPayload = { id: nextId("DED"), ...parsed.data };

  return gate(
    {
      actionKey: "deductions.create",
      module: t.nav.deductions,
      actionLabel: t.auditActions.addDeduction,
      summary: `${deductionTypeLabel(payload.type, t)} — ${payload.amount} EGP`,
    },
    payload,
    () => applyCreateDeduction(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCreateDeduction(payload: DeductionPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  await recordChangeAs(
    actorName,
    {
      module: t.nav.deductions,
      action: t.auditActions.addDeduction,
      newValue: `${deductionTypeLabel(payload.type, t)} — ${payload.amount} EGP`,
      reason: payload.reason,
    },
    (tx) =>
      tx.deduction.create({
        data: {
          id: payload.id,
          employeeId: payload.employeeId,
          type: payload.type,
          amount: Math.round(payload.amount),
          date: new Date(`${payload.date}T00:00:00.000Z`),
          reason: payload.reason,
          notes: payload.notes,
        },
      }),
  );

  revalidatePath("/deductions");
  revalidatePath("/dashboard");
  return { success: true, message: t.deductions.submittedDeduction };
}

export async function deleteDeduction(id: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.deduction.findUnique({ where: { id } });
  if (!existing) return { error: t.validation.notFound };
  const actor = await getSession();

  return gate(
    {
      actionKey: "deductions.delete",
      module: t.nav.deductions,
      actionLabel: t.auditActions.deleteDeduction,
      summary: `${deductionTypeLabel(existing.type, t)} — ${existing.amount} EGP`,
      targetId: id,
    },
    { id },
    () => applyDeleteDeduction({ id }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyDeleteDeduction(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.deduction.findUnique({ where: { id: payload.id } });
  if (!existing) return { error: t.validation.notFound };
  await recordChangeAs(
    actorName,
    {
      module: t.nav.deductions,
      action: t.auditActions.deleteDeduction,
      oldValue: `${deductionTypeLabel(existing.type, t)} — ${existing.amount} EGP`,
    },
    (tx) => tx.deduction.delete({ where: { id: payload.id } }),
  );
  revalidatePath("/deductions");
  return { success: true };
}
