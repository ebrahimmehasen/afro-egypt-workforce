"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canApprove, isSelfService } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { gate } from "@/lib/change-requests";
import { nextId } from "@/lib/id";
import { recalculateRange } from "@/lib/attendance-service";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT, format } from "@/lib/i18n";
import { dayStr } from "@/lib/serialize";
import { checkAnnualLeaveRequest } from "@/lib/leave-balance";
import { loadBalanceInputs, loadDayKindRule } from "@/lib/leave-days";
import { leaveTypeLabel } from "@/lib/i18n/labels";
import { scheduleAttendanceEffects } from "@/lib/attendance-effects";
import { kindOf, loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { lockedDayCheck } from "@/lib/attendance-deductions";
import { checkTimedPermission } from "@/lib/permission-request";
import { Dictionary } from "@/lib/i18n/dictionary";

const leaveSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"]),
  from: z.string().min(1),
  to: z.string().min(1),
  // optional: a leave or excuse can be filed without one (saved as "")
  reason: z.string().trim().max(2000).optional().default(""),
  // a permission only: when the employee leaves and for how many minutes (blank on every other type)
  startTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).optional().default(""),
  durationMinutes: z.union([z.literal(""), z.coerce.number().int().min(0).max(24 * 60)]).optional().default(""),
});

const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Checks a timed permission against the employee's day as it stands now — their working times, the day off and
 * holidays, the approved or closed pay months, and their other permissions that day (`against`: still standing
 * when filing, already approved when approving). Null when it may go ahead, else the message to show.
 */
async function timedPermissionError(
  t: Dictionary,
  p: { employeeId: string; date: string; startTime: string; durationMinutes: number; excludeId?: string },
  against: ("pending" | "approved")[],
): Promise<string | null> {
  const employee = await prisma.employee.findFirst({ where: { id: p.employeeId, deletedAt: null } });
  if (!employee) return t.validation.employeeNotFound;
  const day = dayDate(p.date);
  const [ctx, periods, others] = await Promise.all([
    loadPayContext(),
    prisma.payrollPeriod.findMany({ where: { status: { in: ["approved", "closed"] } } }),
    prisma.leave.findMany({
      where: { employeeId: p.employeeId, type: "permission", status: { in: against }, from: { lte: day }, to: { gte: day }, ...(p.excludeId ? { id: { not: p.excludeId } } : {}) },
    }),
  ]);
  const check = checkTimedPermission({
    date: p.date,
    startTime: p.startTime,
    durationMinutes: p.durationMinutes,
    schedule: scheduleFor(ctx, employee),
    rules: rulesFor(ctx, employee),
    dayKind: kindOf(ctx, p.date),
    locked: lockedDayCheck(periods, ctx)(p.date),
    others,
  });
  if (check.ok) return null;
  const l = t.leaves;
  return {
    duration: l.errDuration,
    outside_hours: format(l.errOutsideHours, { start: clock(check.dayStart), end: clock(check.dayEnd) }),
    overlap: l.errOverlap,
    day_off: l.errDayOff,
    locked: l.errLockedPeriod,
  }[check.reason];
}

const dayDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function createLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = leaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  // A self-service account may only file for itself; anyone else only within
  // the employees they can see. (Server actions are callable directly, so the
  // dialog's employee list is not enough.)
  const actor = await getSession();
  if (!actor) return { error: t.validation.invalidData };
  if (actor.role !== "admin") {
    const own = isSelfService(actor) ? actor.employeeId === parsed.data.employeeId : await canViewEmployee(actor, parsed.data.employeeId);
    if (!own) return { error: t.validation.notAllowed };
  }

  // Annual leave is checked against the employee's balance, for every way a request arrives — the employee filing
  // for themselves or someone else filing for them — not just by what the form shows. Days the balance can't
  // cover are still accepted: they are charged to pay by the absence table when they come.
  // A permission is filed for one day, with the time the employee leaves and for how long; whether it is
  // temporary or for leaving early follows from that time and the employee's hours (see permission-request.ts).
  const timed = parsed.data.type === "permission";
  if (timed) {
    if (!parsed.data.startTime || parsed.data.durationMinutes === "") return { error: t.leaves.errTimeRequired, fields: ["startTime", "durationMinutes"] };
    const error = await timedPermissionError(
      t,
      { employeeId: parsed.data.employeeId, date: parsed.data.from, startTime: parsed.data.startTime, durationMinutes: parsed.data.durationMinutes },
      ["pending", "approved"],
    );
    if (error) return { error };
  }

  let submittedMessage = t.leaves.submitted;
  if (parsed.data.type === "annual") {
    const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employeeId, deletedAt: null } });
    if (!employee) return { error: t.validation.employeeNotFound };
    const year = Number(parsed.data.from.slice(0, 4));
    const [{ leaves, absentDays }, kindOf] = await Promise.all([loadBalanceInputs(employee.id, year), loadDayKindRule()]);
    const check = checkAnnualLeaveRequest({
      hireDate: dayStr(employee.hireDate),
      leaves,
      absentDays,
      from: parsed.data.from,
      to: parsed.data.to,
      now: new Date(),
      kindOf,
    });
    const b = t.leaves.balance;
    if (!check.ok) {
      const message = {
        invalid_days: b.errInvalidDays,
        no_working_days: b.errNoWorkingDays,
        not_eligible: format(b.errNotEligible, { date: check.balance.eligibleOn }),
        other_year: b.errOtherYear,
        notice: b.errNotice,
      }[check.reason];
      return { error: message };
    }
    submittedMessage =
      check.fromPay > 0
        ? format(b.submittedPartlyFromPay, { days: check.days, fromBalance: check.fromBalance, fromPay: check.fromPay })
        : format(b.submittedFromBalance, { days: check.days });
  }

  await prisma.leave.create({
    data: {
      id: nextId("LV"),
      employeeId: parsed.data.employeeId,
      type: parsed.data.type,
      from: dayDate(parsed.data.from),
      to: dayDate(timed ? parsed.data.from : parsed.data.to),
      reason: parsed.data.reason,
      startTime: timed ? parsed.data.startTime : null,
      durationMinutes: timed && parsed.data.durationMinutes !== "" ? parsed.data.durationMinutes : null,
      status: "pending",
    },
  });
  revalidatePath("/leaves");
  return { success: true, message: submittedMessage };
}

type LeaveDecisionPayload = { id: string; decision: "approved" | "rejected" };

export async function decideLeave(id: string, decision: "approved" | "rejected"): Promise<ActionState> {
  const t = await getT();
  const leave = await prisma.leave.findUnique({ where: { id }, include: { employee: true } });
  if (!leave) return { error: t.validation.requestNotFound };
  const actor = await getSession();
  // A leave or excuse is decided by the system admin or HR (holding "leaves") only — for an employee they can
  // see. Anyone else, a department supervisor included, can file and follow it but not decide it.
  if (!actor || !canApprove(actor, "leaves") || !(await canViewEmployee(actor, leave.employeeId))) {
    return { error: t.validation.notAllowed };
  }

  return gate(
    {
      actionKey: "leaves.decide",
      module: t.nav.leaves,
      actionLabel: decision === "approved" ? t.auditActions.approveLeave : t.auditActions.rejectLeave,
      summary: `${leaveTypeLabel(leave.type, t)} — ${leave.employee.employeeNumber} — ${decision === "approved" ? t.statuses.approved : t.statuses.rejected}`,
      targetId: id,
    },
    { id, decision } satisfies LeaveDecisionPayload,
    () => applyDecideLeave({ id, decision }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyDecideLeave(payload: LeaveDecisionPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { id, decision } = payload;
  const leave = await prisma.leave.findUnique({ where: { id }, include: { employee: true } });
  if (!leave) return { error: t.validation.requestNotFound };

  // approving a timed permission checks it again against the day as it is now (hours, pay month, other permissions)
  if (decision === "approved" && leave.type === "permission" && leave.startTime && leave.durationMinutes != null) {
    const error = await timedPermissionError(
      t,
      { employeeId: leave.employeeId, date: dayStr(leave.from), startTime: leave.startTime, durationMinutes: leave.durationMinutes, excludeId: leave.id },
      ["approved"],
    );
    if (error) return { error };
  }

  await recordChangeAs(
    actorName,
    {
      module: t.nav.leaves,
      action: decision === "approved" ? t.auditActions.approveLeave : t.auditActions.rejectLeave,
      oldValue: t.statuses.pending,
      newValue: decision === "approved" ? t.statuses.approved : t.statuses.rejected,
      reason: `${leaveTypeLabel(leave.type, t)} — ${leave.employee.employeeNumber}`,
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
  // the leave changes what those days cost: re-post them now and refresh any calculated payroll
  scheduleAttendanceEffects();
  return { success: true };
}

/**
 * Admin-only: remove a leave request after it has been decided. Not routed
 * through `gate` — nobody else may delete these, not even by request. An
 * approved leave had already been folded into attendance, so its days are
 * recomputed once it's gone.
 */
export async function deleteLeave(id: string): Promise<ActionState> {
  const t = await getT();
  const actor = await getSession();
  if (!actor || actor.role !== "admin") return { error: t.validation.notAllowed };

  const leave = await prisma.leave.findUnique({ where: { id }, include: { employee: true } });
  if (!leave) return { error: t.validation.requestNotFound };

  await recordChangeAs(
    actor.name,
    {
      module: t.nav.leaves,
      action: t.auditActions.deleteLeave,
      oldValue: `${leaveTypeLabel(leave.type, t)} — ${leave.employee.employeeNumber} — ${leave.from.toISOString().slice(0, 10)} → ${leave.to.toISOString().slice(0, 10)} — ${leave.status === "approved" ? t.statuses.approved : leave.status === "rejected" ? t.statuses.rejected : t.statuses.pending}`,
    },
    (tx) => tx.leave.delete({ where: { id } }),
  );

  if (leave.status === "approved") {
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
  // the leave changes what those days cost: re-post them now and refresh any calculated payroll
  scheduleAttendanceEffects();
  return { success: true, message: t.leaves.deleted };
}
