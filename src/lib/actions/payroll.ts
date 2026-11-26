"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { calculatePeriodRecords, previewRecalculation, RecalculationChange } from "@/lib/payroll-recalc";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { getT } from "@/lib/i18n";
import { ActionState } from "@/hooks/use-action-feedback";
import { format } from "@/lib/i18n/format";
import { loadPayContext } from "@/lib/pay-context";
import { payPeriodRange } from "@/lib/pay-rules";
import { loadReviewDays } from "@/lib/missing-punch-review";

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const openPeriodSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

type OpenPeriodPayload = z.infer<typeof openPeriodSchema>;

/** Opens a new payroll period — one draft period per calendar month. */
export async function openPayrollPeriod(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = openPeriodSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { year, month } = parsed.data;

  const existing = await prisma.payrollPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return { error: t.validation.periodExists };

  const actor = await getSession();
  return gate(
    {
      actionKey: "payroll.openPeriod",
      module: t.nav.payroll,
      actionLabel: t.auditActions.openPayrollPeriod,
      summary: `${MONTHS_AR[month - 1]} ${year}`,
    },
    parsed.data,
    () => applyOpenPayrollPeriod(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyOpenPayrollPeriod(payload: OpenPeriodPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { year, month } = payload;
  const existing = await prisma.payrollPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return { error: t.validation.periodExists };

  const label = `${MONTHS_AR[month - 1]} ${year}`;
  await recordChangeAs(
    actorName,
    { module: t.nav.payroll, action: t.auditActions.openPayrollPeriod, newValue: label },
    (tx) => tx.payrollPeriod.create({ data: { label, year, month, status: "draft" } }),
  );

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true, message: t.payroll.periodOpened };
}

type CalculatePayrollPayload = { periodId: string };

export async function calculatePayroll(periodId: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status === "closed") return { error: t.validation.periodClosed };
  const actor = await getSession();

  return gate(
    {
      actionKey: "payroll.calculate",
      module: t.nav.payroll,
      actionLabel: t.auditActions.calculatePayroll,
      summary: period.label,
      targetId: periodId,
    },
    { periodId } satisfies CalculatePayrollPayload,
    () => applyCalculatePayroll({ periodId }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCalculatePayroll(payload: CalculatePayrollPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const result = await calculatePeriodRecords(payload.periodId, actorName, t);
  if (result === "not_found") return { error: t.validation.periodNotFound };
  if (result === "closed") return { error: t.validation.periodClosed };

  revalidatePath("/payroll");
  revalidatePath("/dashboard");
  revalidatePath("/workforce-cost");
  revalidatePath("/audit-log");
  return { success: true };
}

/**
 * What recalculating this period would change, per employee's net salary — for an approved period only, so an
 * admin can see the real impact before confirming (`calculatePayroll`) the recalculation. Closed periods, and
 * periods not yet approved, have nothing to review here: they recalculate freely already.
 */
export async function previewPayrollRecalculation(periodId: string): Promise<RecalculationChange[]> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period || period.status !== "approved") return [];
  return previewRecalculation(periodId);
}

type PeriodIdPayload = { periodId: string };

export async function approvePayrollPeriod(periodId: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "calculated") return { error: t.validation.payrollNotCalculatedFirst };
  const actor = await getSession();

  return gate(
    {
      actionKey: "payroll.approve",
      module: t.nav.payroll,
      actionLabel: t.auditActions.approvePayroll,
      summary: period.label,
      targetId: periodId,
    },
    { periodId } satisfies PeriodIdPayload,
    () => applyApprovePayrollPeriod({ periodId }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyApprovePayrollPeriod(payload: PeriodIdPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: payload.periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "calculated") return { error: t.validation.payrollNotCalculatedFirst };

  // A day with a forgotten punch must be reviewed before the period's calculation is approved. Checked here, in the apply
  // function, so it holds whether the approval is direct or comes through a change request. There is no override: a day
  // stops matching once its punches are complete (the attendance correction, or the punches HR enters after review).
  const ctx = await loadPayContext();
  const { from, to } = payPeriodRange(period.year, period.month, ctx.payPeriodStartDay);
  const pending = await loadReviewDays({ scope: { all: true }, from, to });
  if (pending.length > 0) return { error: format(t.reviewPunch.approveBlocked, { count: pending.length }) };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.payroll,
      action: t.auditActions.approvePayroll,
      oldValue: t.payrollPeriodStatus.calculated,
      newValue: t.payrollPeriodStatus.approved,
      reason: period.label,
    },
    (tx) => tx.payrollPeriod.update({ where: { id: payload.periodId }, data: { status: "approved", approvedAt: new Date() } }),
  );

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true };
}

export async function closePayrollPeriod(periodId: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "approved") return { error: t.validation.payrollApprovedFirst };
  const actor = await getSession();

  return gate(
    {
      actionKey: "payroll.close",
      module: t.nav.payroll,
      actionLabel: t.auditActions.closePayrollPeriod,
      summary: period.label,
      targetId: periodId,
    },
    { periodId } satisfies PeriodIdPayload,
    () => applyClosePayrollPeriod({ periodId }, actor?.name ?? t.auditActions.system),
  );
}

export async function applyClosePayrollPeriod(payload: PeriodIdPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const period = await prisma.payrollPeriod.findUnique({ where: { id: payload.periodId } });
  if (!period) return { error: t.validation.periodNotFound };
  if (period.status !== "approved") return { error: t.validation.payrollApprovedFirst };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.payroll,
      action: t.auditActions.closePayrollPeriod,
      oldValue: t.payrollPeriodStatus.approved,
      newValue: t.payrollPeriodStatus.closed,
      reason: period.label,
    },
    (tx) => tx.payrollPeriod.update({ where: { id: payload.periodId }, data: { status: "closed", closedAt: new Date() } }),
  );

  revalidatePath("/payroll");
  revalidatePath("/audit-log");
  return { success: true };
}
