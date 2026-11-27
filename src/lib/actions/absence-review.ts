"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canApprove } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

// Marking an absence-check notification reviewed. It writes ONE AbsenceReview row (upsert, so marking it twice is a
// no-op) and ONE audit entry — nothing else: no DailyAttendance, Overtime, Deduction or PayrollRecord row is read or
// written, no recalculation runs, and the employee's status is never touched. It is not gated behind the
// change-request approval queue: there is nothing here for anyone to approve, since it changes no number anywhere.

const schema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(2000).optional(),
});
export type MarkAbsenceReviewedInput = z.input<typeof schema>;

export async function markAbsenceReviewed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const actor = await getSession();
  if (!actor || !canApprove(actor, "attendance") || !(await canViewEmployee(actor, parsed.data.employeeId))) return { error: t.validation.notAllowed };

  const { employeeId, date, note } = parsed.data;
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  await recordChangeAs(
    actor.name,
    {
      module: t.nav.attendance,
      action: t.auditActions.markAbsenceReviewed,
      oldValue: `${employee.employeeNumber} — ${date}`,
      newValue: t.statuses.absent,
      reason: note,
    },
    (tx) =>
      tx.absenceReview.upsert({
        where: { employeeId_date: { employeeId, date: new Date(`${date}T00:00:00.000Z`) } },
        create: { employeeId, date: new Date(`${date}T00:00:00.000Z`), reviewedById: actor.id, note: note || null },
        update: { reviewedById: actor.id, note: note || null, reviewedAt: new Date() },
      }),
  );

  revalidatePath("/attendance");
  revalidatePath("/audit-log");
  return { success: true, message: t.absenceReview.done };
}
