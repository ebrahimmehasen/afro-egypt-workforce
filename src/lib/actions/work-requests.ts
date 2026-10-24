"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { ActionState } from "@/hooks/use-action-feedback";
import { canApprove, hasPermission, isSelfService } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";

/**
 * Work requests ("الطلبات"): a supervisor or HR — any account granted "requests" — files a request ("سهر" or
 * anything else) for workers of their department; the system admin or HR (holding "requests") approves or
 * rejects it. A record only: nothing here touches attendance, overtime, deductions or pay.
 */

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const optionalTime = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || TIME.test(v));

const requestSchema = z.object({
  type: z.enum(["late_work", "other"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromTime: optionalTime,
  toTime: optionalTime,
  details: z.string().trim().min(3).max(2000),
});

/** Every employee must exist and be one the account can see (a department supervisor: their department). */
async function allInScope(user: NonNullable<Awaited<ReturnType<typeof getSession>>>, employeeIds: string[]): Promise<boolean> {
  const found = await prisma.employee.count({ where: { id: { in: employeeIds }, deletedAt: null } });
  if (found !== employeeIds.length) return false;
  for (const id of employeeIds) if (!(await canViewEmployee(user, id))) return false;
  return true;
}

export async function createWorkRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const user = await getSession();
  if (!user || isSelfService(user) || !hasPermission(user, "requests")) return { error: t.validation.notAllowed };

  const parsed = requestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const data = parsed.data;
  if (data.type === "late_work" && (!data.fromTime || !data.toTime)) return { error: t.workRequests.errTime, fields: ["fromTime", "toTime"] };

  const employeeIds = [...new Set(formData.getAll("employeeIds").map(String).filter(Boolean))];
  if (employeeIds.length === 0) return { error: t.workRequests.errNoEmployees, fields: ["employeeIds"] };
  if (!(await allInScope(user, employeeIds))) return { error: t.validation.notAllowed };

  const typeLabel = data.type === "late_work" ? t.workRequests.typeLateWork : t.workRequests.typeOther;
  await recordChangeAs(
    user.name,
    {
      module: t.nav.requests,
      action: t.auditActions.addWorkRequest,
      newValue: `${typeLabel} — ${data.date}${data.fromTime ? ` ${data.fromTime} → ${data.toTime ?? ""}` : ""} — ${employeeIds.length}`,
      reason: data.details,
    },
    (tx) =>
      tx.workRequest.create({
        data: {
          type: data.type,
          date: new Date(`${data.date}T00:00:00.000Z`),
          fromTime: data.fromTime,
          toTime: data.toTime,
          details: data.details,
          employeeIds,
          requestedById: user.id,
          requestedBy: user.name,
        },
      }),
  );
  revalidatePath("/requests");
  return { success: true, message: t.workRequests.submitted };
}

/** Approve or reject: the system admin, or HR holding "requests" — and only for workers it can see. */
export async function decideWorkRequest(id: string, decision: "approved" | "rejected", note?: string): Promise<ActionState> {
  const t = await getT();
  const user = await getSession();
  if (!user || !canApprove(user, "requests")) return { error: t.validation.notAllowed };

  const request = await prisma.workRequest.findUnique({ where: { id } });
  if (!request) return { error: t.validation.requestNotFound };
  if (request.status !== "pending") return { error: t.workRequests.errNotPending };
  const employeeIds = Array.isArray(request.employeeIds) ? (request.employeeIds as string[]) : [];
  if (!(await allInScope(user, employeeIds))) return { error: t.validation.notAllowed };

  const decisionNote = note?.trim() ? note.trim().slice(0, 2000) : null;
  let decided = true;
  await recordChangeAs(
    user.name,
    {
      module: t.nav.requests,
      action: decision === "approved" ? t.auditActions.approveWorkRequest : t.auditActions.rejectWorkRequest,
      oldValue: `${request.requestedBy} — ${request.details.slice(0, 120)}`,
      newValue: decision === "approved" ? t.workRequests.approved : t.workRequests.rejected,
      reason: decisionNote ?? undefined,
    },
    // still pending at the moment of writing: two approvers deciding at once can't both win
    async (tx) => {
      const { count } = await tx.workRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: decision, decidedBy: user.name, decidedAt: new Date(), decisionNote },
      });
      // rolls the audit row back too: someone else decided it first
      if (count === 0) throw new AlreadyDecided();
    },
  ).catch((e) => {
    if (!(e instanceof AlreadyDecided)) throw e;
    decided = false;
  });
  if (!decided) return { error: t.workRequests.errNotPending };

  revalidatePath("/requests");
  return { success: true, message: decision === "approved" ? t.workRequests.approvedMessage : t.workRequests.rejectedMessage };
}

class AlreadyDecided extends Error {}
