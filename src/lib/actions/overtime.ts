"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/data";
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
  const t = getT();
  const parsed = overtimeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const db = getDb();
  db.overtime.push({
    id: nextId("OT"),
    employeeId: parsed.data.employeeId,
    date: parsed.data.date,
    hours: parsed.data.hours,
    hourlyRate: parsed.data.hourlyRate,
    amount: Math.round(parsed.data.hours * parsed.data.hourlyRate),
    notes: parsed.data.notes,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  revalidatePath("/overtime");
  return { success: true, message: t.overtime.submitted };
}

export async function decideOvertime(id: string, decision: "approved" | "rejected") {
  const t = getT();
  const db = getDb();
  const user = getSession();
  const overtime = db.overtime.find((o) => o.id === id);
  if (!overtime) return { error: t.validation.requestNotFound };

  overtime.status = decision;
  overtime.approvedBy = user?.name ?? t.auditActions.system;

  addAuditLog({
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
