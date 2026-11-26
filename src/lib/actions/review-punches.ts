"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { canApprove } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { loadPayContext } from "@/lib/pay-context";
import { lockedDayCheck } from "@/lib/attendance-deductions";
import { withoutQuarantined } from "@/lib/punch-quarantine";
import { hrReviewPayload, reviewedTimes, type ReviewedTimesError } from "@/lib/hr-review-punch";
import { scheduleAttendanceEffects } from "@/lib/attendance-effects";

// The exit and/or return HR knows for a day with a forgotten punch (hr-review-punch.ts). It only ADDS AttendanceLog rows:
// no existing punch is deleted or changed, no estimate is made, and nothing here charges or waives anything — the
// existing deduction job reads the new punches like any other and works the day out from Settings.

const schema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outTime: z.string().optional(),
  backTime: z.string().optional(),
  reason: z.string().trim().min(3).max(2000),
});
export type ReviewPunchesInput = z.input<typeof schema>;

export async function addReviewedPunches(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.some((i) => i.path[0] === "reason") ? t.reviewPunch.errReason : t.validation.invalidData };

  // the admin, or HR holding the attendance right, for an employee in their departments
  const actor = await getSession();
  if (!actor || !canApprove(actor, "attendance") || !(await canViewEmployee(actor, parsed.data.employeeId))) return { error: t.validation.notAllowed };
  const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.invalidData };

  return gate(
    {
      actionKey: "attendance.reviewPunches",
      module: t.nav.attendance,
      actionLabel: t.reviewPunch.action,
      summary: `${employee.name} (${employee.employeeNumber}) — ${parsed.data.date} — ${parsed.data.outTime || "—"} → ${parsed.data.backTime || "—"}`,
      targetId: employee.id,
    },
    parsed.data,
    () => applyAddReviewedPunches(parsed.data, actor.name),
  );
}

export async function applyAddReviewedPunches(input: ReviewPunchesInput, actorName: string): Promise<ActionState> {
  const t = await getT();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues.some((i) => i.path[0] === "reason") ? t.reviewPunch.errReason : t.validation.invalidData };
  const { employeeId, date, outTime, backTime, reason } = parsed.data;

  const [ctx, periods] = await Promise.all([loadPayContext(), prisma.payrollPeriod.findMany({ where: { status: "closed" } })]);
  if (lockedDayCheck(periods, ctx)(date)) return { error: t.leaves.errLockedPeriod };

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  const day = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId, date: new Date(`${date}T00:00:00.000Z`) } } });
  if (!day || !day.actualIn || !day.actualOut) return { error: t.reviewPunch.errNoDay };

  const existing = withoutQuarantined(
    await prisma.attendanceLog.findMany({ where: { employeeId, timestamp: { gte: day.actualIn, lte: day.actualOut } }, select: { timestamp: true, rawPayload: true } }),
  ).map((l) => l.timestamp);
  const times = reviewedTimes({ date, actualIn: day.actualIn, actualOut: day.actualOut, outTime, backTime, existing });
  if (!times.ok) {
    const errors: Record<ReviewedTimesError, string> = {
      needOne: t.reviewPunch.errNeedOne,
      badTime: t.reviewPunch.errBadTime,
      backBeforeOut: t.reviewPunch.errBackBeforeOut,
      outsideDay: t.reviewPunch.errOutsideDay,
      duplicate: t.reviewPunch.errDuplicate,
    };
    return { error: errors[times.error] };
  }

  const at = new Date().toISOString();
  const entries = [
    ...(times.out ? [{ timestamp: times.out, punchType: "out" as const, role: "out" as const }] : []),
    ...(times.back ? [{ timestamp: times.back, punchType: "in" as const, role: "back" as const }] : []),
  ];
  await recordChangeAs(
    actorName,
    {
      module: t.nav.attendance,
      action: t.auditActions.reviewPunches,
      oldValue: `${employee.employeeNumber} — ${date}`,
      newValue: `${outTime || "—"} → ${backTime || "—"}`,
      reason,
    },
    async (tx) => {
      // only ever adds rows: no punch that exists is touched
      for (const e of entries) {
        await tx.attendanceLog.create({
          data: { employeeId, timestamp: e.timestamp, punchType: e.punchType, source: "manual_correction", rawPayload: hrReviewPayload({ by: actorName, reason, at, role: e.role }) },
        });
      }
    },
  );

  revalidatePath("/attendance");
  revalidatePath("/audit-log");
  // the existing posting job reads the new punches like any other (nothing is charged here)
  scheduleAttendanceEffects();
  return { success: true, message: t.reviewPunch.done };
}
