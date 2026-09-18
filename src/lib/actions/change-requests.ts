"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canManagePermissions } from "@/lib/permissions";
import { recordChangeAs } from "@/lib/audit";
import { getT } from "@/lib/i18n";
import { ActionState } from "@/hooks/use-action-feedback";

import { applyCreateDepartment, applyUpdateDepartment, applyDeleteDepartment } from "@/lib/actions/departments";
import { applyCreateEmployee, applyUpdateEmployee, applyDeleteEmployee } from "@/lib/actions/employees";
import { applyCreateShift, applyUpdateShift } from "@/lib/actions/shifts";
import { applyCreateDeduction, applyDeleteDeduction } from "@/lib/actions/deductions";
import { applyCreateAllowance, applyDeleteAllowance } from "@/lib/actions/allowances";
import { applySimulatePunch, applyCorrectAttendance } from "@/lib/actions/attendance";
import { applyDecideLeave } from "@/lib/actions/leaves";
import { applyDecideOvertime } from "@/lib/actions/overtime";
import {
  applyOpenPayrollPeriod, applyCalculatePayroll, applyApprovePayrollPeriod, applyClosePayrollPeriod,
} from "@/lib/actions/payroll";
import {
  applyUpdateCompanySettings, applyUpdateAttendanceSettings, applyUpdatePayrollSettings,
} from "@/lib/actions/settings";

/**
 * Every actionKey a `gate()` call can enqueue, mapped to the function that
 * actually performs the write. Adding a new gated action means adding one
 * line here — the dispatch key must match exactly what that action passes
 * to `gate()`.
 */
const APPLIERS: Record<string, (payload: unknown, actorName: string) => Promise<ActionState>> = {
  "departments.create": (p, a) => applyCreateDepartment(p as never, a),
  "departments.update": (p, a) => applyUpdateDepartment(p as never, a),
  "departments.delete": (p, a) => applyDeleteDepartment(p as never, a),
  "employees.create": (p, a) => applyCreateEmployee(p as never, a),
  "employees.update": (p, a) => applyUpdateEmployee(p as never, a),
  "employees.delete": (p, a) => applyDeleteEmployee(p as never, a),
  "shifts.create": (p, a) => applyCreateShift(p as never, a),
  "shifts.update": (p, a) => applyUpdateShift(p as never, a),
  "deductions.create": (p, a) => applyCreateDeduction(p as never, a),
  "deductions.delete": (p, a) => applyDeleteDeduction(p as never, a),
  "allowances.create": (p, a) => applyCreateAllowance(p as never, a),
  "allowances.delete": (p, a) => applyDeleteAllowance(p as never, a),
  "attendance.simulatePunch": (p, a) => applySimulatePunch(p as never, a),
  "attendance.correct": (p, a) => applyCorrectAttendance(p as never, a),
  "leaves.decide": (p, a) => applyDecideLeave(p as never, a),
  "overtime.decide": (p, a) => applyDecideOvertime(p as never, a),
  "payroll.openPeriod": (p, a) => applyOpenPayrollPeriod(p as never, a),
  "payroll.calculate": (p, a) => applyCalculatePayroll(p as never, a),
  "payroll.approve": (p, a) => applyApprovePayrollPeriod(p as never, a),
  "payroll.close": (p, a) => applyClosePayrollPeriod(p as never, a),
  "settings.company": (p, a) => applyUpdateCompanySettings(p as never, a),
  "settings.attendance": (p, a) => applyUpdateAttendanceSettings(p as never, a),
  "settings.payroll": (p, a) => applyUpdatePayrollSettings(p as never, a),
};

async function guard() {
  const user = await getSession();
  if (!user || !canManagePermissions(user.role)) return null;
  return user;
}

export async function rejectChangeRequest(id: string, reason?: string): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const cr = await prisma.changeRequest.findUnique({ where: { id } });
  if (!cr) return { error: t.changeRequests.notFound };
  if (cr.status !== "pending") return { error: t.changeRequests.alreadyReviewed };

  await recordChangeAs(
    actor.name,
    {
      module: t.nav.changeRequests,
      action: t.changeRequests.reject,
      oldValue: `${cr.requestedBy} — ${cr.module} — ${cr.actionLabel}`,
      newValue: cr.summary,
      reason: reason ?? undefined,
    },
    (tx) =>
      tx.changeRequest.update({
        where: { id },
        data: { status: "rejected", reviewedBy: actor.name, reviewedAt: new Date(), reviewNote: reason ?? null },
      }),
  );

  revalidatePath("/change-requests");
  return { success: true, message: t.changeRequests.rejectedMessage };
}

export async function approveChangeRequest(id: string): Promise<ActionState> {
  const t = await getT();
  const actor = await guard();
  if (!actor) return { error: t.validation.invalidData };

  const cr = await prisma.changeRequest.findUnique({ where: { id } });
  if (!cr) return { error: t.changeRequests.notFound };
  if (cr.status !== "pending") return { error: t.changeRequests.alreadyReviewed };

  const apply = APPLIERS[cr.actionKey];
  if (!apply) return { error: t.changeRequests.applyFailed };

  // Attribute the actual write to the ORIGINAL requester (audit log stays
  // accurate about who made the change) — the admin's approval is a separate
  // audit row of its own, recorded right after.
  const result = await apply(cr.payload, cr.requestedBy);
  if (result?.error) return result;

  await recordChangeAs(
    actor.name,
    {
      module: t.nav.changeRequests,
      action: t.changeRequests.approve,
      oldValue: `${cr.requestedBy} — ${cr.module} — ${cr.actionLabel}`,
      newValue: cr.summary,
    },
    (tx) =>
      tx.changeRequest.update({
        where: { id },
        data: { status: "approved", reviewedBy: actor.name, reviewedAt: new Date() },
      }),
  );

  revalidatePath("/change-requests");
  return { success: true, message: t.changeRequests.approvedMessage };
}
