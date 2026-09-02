"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
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

export async function decideOvertime(id: string, decision: "approved" | "rejected") {
  const t = await getT();
  const user = await getSession();
  const overtime = await prisma.overtime.findUnique({ where: { id } });
  if (!overtime) return { error: t.validation.requestNotFound };

  await prisma.overtime.update({
    where: { id },
    data: { status: decision, approvedBy: user?.name ?? t.auditActions.system },
  });

  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: decision === "approved" ? t.auditActions.approveOvertime : t.auditActions.rejectOvertime,
    module: t.nav.overtime,
    oldValue: t.statuses.pending,
    newValue: decision === "approved" ? t.statuses.approved : t.statuses.rejected,
    reason: `${overtime.employeeId} — ${overtime.hours} ${t.common.hours}`,
  });

  revalidatePath("/overtime");
  revalidatePath("/dashboard");
  revalidatePath("/audit-log");
  return { success: true };
}
