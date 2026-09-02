"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { nextId } from "@/lib/id";
import { recalculateDailyAttendance } from "@/lib/attendance-service";
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

function datesBetween(from: string, to: string) {
  const dates: string[] = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export async function decideLeave(id: string, decision: "approved" | "rejected") {
  const t = await getT();
  const user = await getSession();
  const leave = await prisma.leave.findUnique({ where: { id } });
  if (!leave) return { error: t.validation.requestNotFound };

  await prisma.leave.update({
    where: { id },
    data: { status: decision, approvedBy: user?.name ?? t.auditActions.system },
  });

  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: decision === "approved" ? t.auditActions.approveLeave : t.auditActions.rejectLeave,
    module: t.nav.leaves,
    oldValue: t.statuses.pending,
    newValue: decision === "approved" ? t.statuses.approved : t.statuses.rejected,
    reason: `${leaveTypeLabel(leave.type, t)} — ${leave.employeeId}`,
  });

  if (decision === "approved") {
    for (const date of datesBetween(leave.from.toISOString().slice(0, 10), leave.to.toISOString().slice(0, 10))) {
      await recalculateDailyAttendance(leave.employeeId, date);
    }
  }

  revalidatePath("/leaves");
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath("/audit-log");
  return { success: true };
}
