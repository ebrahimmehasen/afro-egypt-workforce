"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { isSelfService } from "@/lib/permissions";
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
