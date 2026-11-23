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
import { loadPayContext } from "@/lib/pay-context";
import { lockedDayCheck } from "@/lib/attendance-deductions";
import { ANNOTATION_TYPES, annotationKey } from "@/lib/exit-annotation";
import { withoutQuarantined } from "@/lib/punch-quarantine";

// Recording that an exit stretch was a mission or an excused absence. A note and nothing more (exit-annotation.ts):
// it writes ONE audit-log entry — no Leave, no DailyAttendance / Overtime / Deduction / payroll row, no recalculation
// and no run of the attendance effects — so it can never change a charge. The stretch is still counted as it was.

const annotateSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(ANNOTATION_TYPES),
  out: z.string().datetime(),
  back: z.string().datetime(),
  reason: z.string().trim().min(3).max(2000),
});
export type AnnotateExitInput = z.input<typeof annotateSchema>;

export async function annotateExit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = annotateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.some((i) => i.path[0] === "reason") ? t.midDay.errAnnotateReason : t.validation.invalidData };
  }
  // the same right as classifying with a permission: who may approve leaves, for an employee the account can see
  const actor = await getSession();
  if (!actor || !canApprove(actor, "leaves") || !(await canViewEmployee(actor, parsed.data.employeeId))) {
    return { error: t.validation.notAllowed };
  }
  return applyAnnotateExit(parsed.data, actor.name);
}

export async function applyAnnotateExit(input: AnnotateExitInput, actorName: string): Promise<ActionState> {
  const t = await getT();
  const parsed = annotateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.some((i) => i.path[0] === "reason") ? t.midDay.errAnnotateReason : t.validation.invalidData };
  }
  const { employeeId, date, type, out, back, reason } = parsed.data;

  // a day inside an approved or closed pay month is refused, like the permission: nothing about it is touched
  const [ctx, periods] = await Promise.all([loadPayContext(), prisma.payrollPeriod.findMany({ where: { status: { in: ["approved", "closed"] } } })]);
  if (lockedDayCheck(periods, ctx)(date)) return { error: t.leaves.errLockedPeriod };

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  // the stretch has to be a real one: both of its punches are the employee's own
  const punches = withoutQuarantined(
    await prisma.attendanceLog.findMany({ where: { employeeId, timestamp: { in: [new Date(out), new Date(back)] } }, select: { timestamp: true, rawPayload: true } }),
  );
  const times = new Set(punches.map((p) => p.timestamp.toISOString()));
  if (!times.has(new Date(out).toISOString()) || !times.has(new Date(back).toISOString()) || new Date(back) <= new Date(out)) {
    return { error: t.midDay.errAnnotateStretch };
  }

  const label = type === "mission" ? t.leaveTypes.mission : t.leaveTypes.excusedAbsence;
  await recordChangeAs(
    actorName,
    {
      module: t.nav.attendance,
      action: t.auditActions.annotateExit,
      oldValue: annotationKey({ employeeId, date, out: new Date(out).toISOString(), back: new Date(back).toISOString(), type }),
      newValue: `${label} — ${employee.employeeNumber} — ${date}`,
      reason,
    },
    // nothing else is written: the audit entry is the whole record
    async () => undefined,
  );

  revalidatePath("/attendance");
  revalidatePath("/audit-log");
  return { success: true, message: t.midDay.annotateDone };
}
