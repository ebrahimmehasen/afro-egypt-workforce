"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { hasPermission, isSelfService } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { gate } from "@/lib/change-requests";
import { nextId } from "@/lib/id";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

const overtimeSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  hours: z.coerce.number().positive(),
  hourlyRate: z.coerce.number().positive(),
  notes: z.string().optional(),
});

export async function createOvertime(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = overtimeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const actor = await getSession();
  if (!actor) return { error: t.validation.invalidData };
  if (actor.role !== "admin" && (isSelfService(actor) || !(await canViewEmployee(actor, parsed.data.employeeId)))) {
    return { error: t.validation.notAllowed };
  }

  await prisma.overtime.create({
    data: {
      id: nextId("OT"),
      employeeId: parsed.data.employeeId,
      date: new Date(`${parsed.data.date}T00:00:00.000Z`),
      hours: parsed.data.hours,
      hourlyRate: Math.round(parsed.data.hourlyRate),
      amount: Math.round(parsed.data.hours * parsed.data.hourlyRate),
      notes: parsed.data.notes,
      status: "pending",
    },
  });
  revalidatePath("/overtime");
  return { success: true, message: t.overtime.submitted };
}

type OvertimeDecisionPayload = { id: string; decision: "approved" | "rejected" };

export async function decideOvertime(id: string, decision: "approved" | "rejected"): Promise<ActionState> {
  const t = await getT();
  const overtime = await prisma.overtime.findUnique({ where: { id }, include: { employee: true } });
  if (!overtime) return { error: t.validation.requestNotFound };
  const actor = await getSession();

  return gate(
    {
      actionKey: "overtime.decide",
      module: t.nav.overtime,
      actionLabel: decision === "approved" ? t.auditActions.approveOvertime : t.auditActions.rejectOvertime,
      summary: `${overtime.employee.employeeNumber} — ${overtime.hours} ${t.common.hours} — ${decision === "approved" ? t.statuses.approved : t.statuses.rejected}`,
      targetId: id,
    },
    { id, decision } satisfies OvertimeDecisionPayload,
    () => applyDecideOvertime({ id, decision }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyDecideOvertime(payload: OvertimeDecisionPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { id, decision } = payload;
  const overtime = await prisma.overtime.findUnique({ where: { id }, include: { employee: true } });
  if (!overtime) return { error: t.validation.requestNotFound };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.overtime,
      action: decision === "approved" ? t.auditActions.approveOvertime : t.auditActions.rejectOvertime,
      oldValue: t.statuses.pending,
      newValue: decision === "approved" ? t.statuses.approved : t.statuses.rejected,
      reason: `${overtime.employee.employeeNumber} — ${overtime.hours} ${t.common.hours}`,
    },
    (tx) => tx.overtime.update({ where: { id }, data: { status: decision, approvedBy: actorName } }),
  );

  revalidatePath("/overtime");
  revalidatePath("/dashboard");
  revalidatePath("/audit-log");
  return { success: true };
}

const updateOvertimeSchema = z.object({
  id: z.string().min(1),
  hours: z.coerce.number().min(0),
  hourlyRate: z.coerce.number().min(0),
  notes: z.string().optional(),
});
type UpdateOvertimePayload = z.infer<typeof updateOvertimeSchema>;

/**
 * Change an addition's hours or rate — including one the system calculated, whose calculated values stay on
 * record (originalHours / originalAmount) next to the edited ones, with who changed it. The system never
 * recalculates an entry after it has been edited.
 */
export async function updateOvertime(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const actor = await getSession();
  if (!actor || !hasPermission(actor, "overtime")) return { error: t.validation.notAllowed };
  const parsed = updateOvertimeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const existing = await prisma.overtime.findUnique({ where: { id: parsed.data.id }, include: { employee: true } });
  if (!existing) return { error: t.validation.requestNotFound };

  return gate(
    {
      actionKey: "overtime.update",
      module: t.nav.overtime,
      actionLabel: t.auditActions.editOvertime,
      summary: `${existing.employee.name} — ${existing.hours} → ${parsed.data.hours} ${t.common.hours}`,
      targetId: existing.id,
    },
    parsed.data,
    () => applyUpdateOvertime(parsed.data, actor.name),
  );
}

export async function applyUpdateOvertime(payload: UpdateOvertimePayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.overtime.findUnique({ where: { id: payload.id } });
  if (!existing) return { error: t.validation.requestNotFound };
  const amount = Math.round(payload.hours * payload.hourlyRate);
  await recordChangeAs(
    actorName,
    {
      module: t.nav.overtime,
      action: t.auditActions.editOvertime,
      oldValue: `${existing.hours} ${t.common.hours} — ${existing.amount} EGP`,
      newValue: `${payload.hours} ${t.common.hours} — ${amount} EGP`,
      reason: payload.notes,
    },
    (tx) =>
      tx.overtime.update({
        where: { id: payload.id },
        data: {
          hours: payload.hours,
          hourlyRate: Math.round(payload.hourlyRate),
          amount,
          notes: payload.notes || existing.notes,
          ...(existing.autoGenerated ? { editedBy: actorName, editedAt: new Date() } : {}),
        },
      }),
  );
  revalidatePath("/overtime");
  revalidatePath("/employees");
  revalidatePath("/dashboard");
  return { success: true, message: t.overtime.updated };
}

/** Remove an addition. One the system calculated is set aside (voided) rather than deleted, so its
 * calculation stays on record and the system doesn't post that day again. */
export async function deleteOvertime(id: string): Promise<ActionState> {
  const t = await getT();
  const actor = await getSession();
  if (!actor || !hasPermission(actor, "overtime")) return { error: t.validation.notAllowed };
  const existing = await prisma.overtime.findUnique({ where: { id }, include: { employee: true } });
  if (!existing) return { error: t.validation.requestNotFound };

  return gate(
    {
      actionKey: "overtime.delete",
      module: t.nav.overtime,
      actionLabel: t.auditActions.deleteOvertime,
      summary: `${existing.employee.name} — ${existing.hours} ${t.common.hours} — ${existing.amount} EGP`,
      targetId: id,
    },
    { id },
    () => applyDeleteOvertime({ id }, actor.name),
  );
}

export async function applyDeleteOvertime(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.overtime.findUnique({ where: { id: payload.id } });
  if (!existing) return { error: t.validation.requestNotFound };
  await recordChangeAs(
    actorName,
    { module: t.nav.overtime, action: t.auditActions.deleteOvertime, oldValue: `${existing.hours} ${t.common.hours} — ${existing.amount} EGP` },
    (tx) =>
      existing.systemKey
        ? tx.overtime.update({ where: { id: payload.id }, data: { voidedAt: new Date(), voidedBy: actorName } })
        : tx.overtime.delete({ where: { id: payload.id } }),
  );
  revalidatePath("/overtime");
  revalidatePath("/employees");
  revalidatePath("/dashboard");
  return { success: true, message: t.overtime.deleted };
}
