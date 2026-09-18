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
import { allowanceTypeLabel } from "@/lib/i18n/labels";

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

type AllowancePayload = z.infer<typeof allowanceSchema> & { id: string };

export async function createAllowance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = allowanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const actor = await getSession();
  const payload: AllowancePayload = { id: nextId("ALW"), ...parsed.data };

  return gate(
    {
      actionKey: "allowances.create",
      module: t.nav.deductions,
      actionLabel: t.auditActions.addAllowance,
      summary: `${allowanceTypeLabel(payload.type, t)} — ${payload.amount} EGP`,
    },
    payload,
    () => applyCreateAllowance(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCreateAllowance(payload: AllowancePayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { type, effectiveYear, effectiveMonth } = payload;
  const oneOff = type === "bonus";

  await recordChangeAs(
    actorName,
    {
      module: t.nav.deductions,
      action: t.auditActions.addAllowance,
      newValue: `${allowanceTypeLabel(type, t)} — ${payload.amount} EGP`,
    },
    (tx) =>
      tx.allowance.create({
        data: {
          id: payload.id,
          employeeId: payload.employeeId,
          type,
          amount: Math.round(payload.amount),
          notes: payload.notes,
          monthly: !oneOff,
          effectiveYear: oneOff ? effectiveYear ?? null : null,
          effectiveMonth: oneOff ? effectiveMonth ?? null : null,
        },
      }),
  );
  revalidatePath("/deductions");
  revalidatePath("/dashboard");
  return { success: true, message: t.deductions.submittedAllowance };
}

export async function deleteAllowance(id: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.allowance.findUnique({ where: { id } });
  if (!existing) return { error: t.validation.notFound };
  const actor = await getSession();

  return gate(
    {
      actionKey: "allowances.delete",
      module: t.nav.deductions,
      actionLabel: t.auditActions.deleteAllowance,
      summary: `${allowanceTypeLabel(existing.type, t)} — ${existing.amount} EGP`,
      targetId: id,
    },
    { id },
    () => applyDeleteAllowance({ id }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyDeleteAllowance(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.allowance.findUnique({ where: { id: payload.id } });
  if (!existing) return { error: t.validation.notFound };
  await recordChangeAs(
    actorName,
    { module: t.nav.deductions, action: t.auditActions.deleteAllowance, oldValue: `${allowanceTypeLabel(existing.type, t)} — ${existing.amount} EGP` },
    (tx) => tx.allowance.delete({ where: { id: payload.id } }),
  );
  revalidatePath("/deductions");
  return { success: true };
}
