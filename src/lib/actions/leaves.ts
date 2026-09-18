"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { nextId } from "@/lib/id";
import { recalculateRange } from "@/lib/attendance-service";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { leaveTypeLabel } from "@/lib/i18n/labels";

const leaveSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"]),
  from: z.string().min(1),
  to: z.string().min(1),
  reason: z.string().min(3),
});

const dayDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function createLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = leaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  await prisma.leave.create({
    data: {
      id: nextId("LV"),
      employeeId: parsed.data.employeeId,
      type: parsed.data.type,
      from: dayDate(parsed.data.from),
      to: dayDate(parsed.data.to),
      reason: parsed.data.reason,
      status: "pending",
    },
  });
  revalidatePath("/leaves");
  return { success: true, message: t.leaves.submitted };
}

type LeaveDecisionPayload = { id: string; decision: "approved" | "rejected" };

export async function decideLeave(id: string, decision: "approved" | "rejected"): Promise<ActionState> {
  const t = await getT();
  const leave = await prisma.leave.findUnique({ where: { id } });
  if (!leave) return { error: t.validation.requestNotFound };
  const actor = await getSession();

  return gate(
    {
      actionKey: "leaves.decide",
      module: t.nav.leaves,
      actionLabel: decision === "approved" ? t.auditActions.approveLeave : t.auditActions.rejectLeave,
      summary: `${leaveTypeLabel(leave.type, t)} — ${leave.employeeId} — ${decision === "approved" ? t.statuses.approved : t.statuses.rejected}`,
      targetId: id,
    },
    { id, decision } satisfies LeaveDecisionPayload,
    () => applyDecideLeave({ id, decision }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyDecideLeave(payload: LeaveDecisionPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { id, decision } = payload;
  const leave = await prisma.leave.findUnique({ where: { id } });
  if (!leave) return { error: t.validation.requestNotFound };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.leaves,
      action: decision === "approved" ? t.auditActions.approveLeave : t.auditActions.rejectLeave,
      oldValue: t.statuses.pending,
      newValue: decision === "approved" ? t.statuses.approved : t.statuses.rejected,
      reason: `${leaveTypeLabel(leave.type, t)} — ${leave.employeeId}`,
    },
    (tx) => tx.leave.update({ where: { id }, data: { status: decision, approvedBy: actorName } }),
  );

  if (decision === "approved") {
    await recalculateRange(
      leave.employeeId,
      leave.from.toISOString().slice(0, 10),
      leave.to.toISOString().slice(0, 10),
    );
  }

  revalidatePath("/leaves");
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath("/audit-log");
  return { success: true };
}
