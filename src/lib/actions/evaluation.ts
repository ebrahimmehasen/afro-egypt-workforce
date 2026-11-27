"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { canUseEvaluation } from "@/lib/evaluation/access";
import { EVALUATION_LIMITS as L } from "@/lib/evaluation/config";
import { ActionState } from "@/hooks/use-action-feedback";

// Everything here is admin-only (canUseEvaluation), writes only the evaluation tables (JobLevel,
// EmployeeLevelChange, EvaluationScaleItem, EvaluationReview) and the audit log, and refreshes only /evaluation
// pages — never /payroll, /attendance, /deductions or anything a pay calculation reads. No row outside this
// feature's own tables is ever touched here.

async function adminOnly() {
  const t = await getT();
  const user = await getSession();
  if (!user || !canUseEvaluation(user)) return { t, user: null, error: t.validation.notAllowed };
  return { t, user, error: null };
}

function refreshEvaluation(employeeId?: string) {
  revalidatePath("/evaluation");
  if (employeeId) revalidatePath(`/evaluation/${employeeId}`);
}

// ---------------------------------------------------------------------------------------------------------
// Manager entries: set an employee's job level (a new history row), add a performance evaluation

const setLevelSchema = z.object({
  employeeId: z.string().min(1),
  jobLevelId: z.string().min(1),
  reason: z.string().trim().min(1).max(L.maxLevelChangeReasonLength),
});

export async function setEmployeeJobLevel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const parsed = setLevelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "reason" ? t.evaluation.setLevel.errReason : field === "jobLevelId" ? t.evaluation.setLevel.errLevel : t.validation.invalidData, fields: [String(field)] };
  }
  const { employeeId, jobLevelId, reason } = parsed.data;

  const [employee, jobLevel] = await Promise.all([
    prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } }),
    prisma.jobLevel.findFirst({ where: { id: jobLevelId, deletedAt: null } }),
  ]);
  if (!employee) return { error: t.validation.employeeNotFound };
  if (!jobLevel) return { error: t.evaluation.setLevel.errLevel, fields: ["jobLevelId"] };

  await recordChangeAs(
    user.name,
    { module: t.nav.evaluation, action: t.auditActions.setEmployeeJobLevel, oldValue: employee.employeeNumber, newValue: jobLevel.name, reason },
    (tx) => tx.employeeLevelChange.create({ data: { employeeId, jobLevelId, reason, changedById: user.id, changedByName: user.name } }),
  );
  refreshEvaluation(employeeId);
  return { success: true, message: t.evaluation.setLevel.done };
}

const addReviewSchema = z.object({
  employeeId: z.string().min(1),
  periodLabel: z.string().trim().min(1).max(L.maxEvaluationPeriodLabelLength),
  periodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scaleItemId: z.string().min(1),
  comment: z.string().trim().max(L.maxEvaluationCommentLength).optional(),
});

export async function addEvaluationReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const parsed = addReviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      error:
        field === "periodLabel" ? t.evaluation.addReview.errPeriodLabel
        : field === "periodDate" ? t.evaluation.addReview.errPeriodDate
        : field === "scaleItemId" ? t.evaluation.addReview.errRating
        : t.validation.invalidData,
      fields: [String(field)],
    };
  }
  const { employeeId, periodLabel, periodDate, scaleItemId, comment } = parsed.data;

  const [employee, scaleItem] = await Promise.all([
    prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } }),
    prisma.evaluationScaleItem.findFirst({ where: { id: scaleItemId, deletedAt: null } }),
  ]);
  if (!employee) return { error: t.validation.employeeNotFound };
  if (!scaleItem) return { error: t.evaluation.addReview.errRating, fields: ["scaleItemId"] };

  await recordChangeAs(
    user.name,
    { module: t.nav.evaluation, action: t.auditActions.addEvaluationReview, oldValue: employee.employeeNumber, newValue: `${periodLabel} — ${scaleItem.label}`, reason: comment },
    (tx) =>
      tx.evaluationReview.create({
        data: { employeeId, periodLabel, periodDate: new Date(`${periodDate}T00:00:00.000Z`), scaleItemId, comment: comment || null, createdById: user.id, createdByName: user.name },
      }),
  );
  refreshEvaluation(employeeId);
  return { success: true, message: t.evaluation.addReview.done };
}

// ---------------------------------------------------------------------------------------------------------
// Settings: the job-level list and the rating scale (admin only, nothing seeded)

const nameSchema = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(L.maxJobLevelNameLength), sortOrder: z.coerce.number().int().min(0).max(L.maxSortOrder) });

export async function saveJobLevel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const parsed = nameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.nameRequired, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const { id, name, sortOrder } = parsed.data;

  const before = id ? await prisma.jobLevel.findUnique({ where: { id } }) : null;
  if (id && !before) return { error: t.validation.notFound };

  await recordChangeAs(
    user.name,
    { module: t.nav.evaluation, action: id ? t.auditActions.editJobLevel : t.auditActions.addJobLevel, oldValue: before?.name, newValue: name },
    (tx) => (id ? tx.jobLevel.update({ where: { id }, data: { name, sortOrder } }) : tx.jobLevel.create({ data: { name, sortOrder } })),
  );
  revalidatePath("/settings");
  revalidatePath("/evaluation");
  return { success: true, message: t.evaluation.settings.saved };
}

export async function deleteJobLevel(id: string): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const level = await prisma.jobLevel.findUnique({ where: { id }, include: { _count: { select: { changes: true } } } });
  if (!level) return { error: t.validation.notFound };

  const inUse = level._count.changes > 0;
  await recordChangeAs(
    user.name,
    { module: t.nav.evaluation, action: t.auditActions.deleteJobLevel, oldValue: level.name, newValue: inUse ? t.evaluation.settings.inUse : "-" },
    (tx) => (inUse ? tx.jobLevel.update({ where: { id }, data: { deletedAt: new Date() } }) : tx.jobLevel.delete({ where: { id } })),
  );
  revalidatePath("/settings");
  revalidatePath("/evaluation");
  return { success: true, message: t.evaluation.settings.deleted };
}

const labelSchema = z.object({ id: z.string().optional(), label: z.string().trim().min(1).max(L.maxRatingLabelLength), sortOrder: z.coerce.number().int().min(0).max(L.maxSortOrder) });

export async function saveEvaluationScaleItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const parsed = labelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.nameRequired, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const { id, label, sortOrder } = parsed.data;

  const before = id ? await prisma.evaluationScaleItem.findUnique({ where: { id } }) : null;
  if (id && !before) return { error: t.validation.notFound };

  await recordChangeAs(
    user.name,
    { module: t.nav.evaluation, action: id ? t.auditActions.editEvaluationScaleItem : t.auditActions.addEvaluationScaleItem, oldValue: before?.label, newValue: label },
    (tx) => (id ? tx.evaluationScaleItem.update({ where: { id }, data: { label, sortOrder } }) : tx.evaluationScaleItem.create({ data: { label, sortOrder } })),
  );
  revalidatePath("/settings");
  revalidatePath("/evaluation");
  return { success: true, message: t.evaluation.settings.saved };
}

export async function deleteEvaluationScaleItem(id: string): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const item = await prisma.evaluationScaleItem.findUnique({ where: { id }, include: { _count: { select: { reviews: true } } } });
  if (!item) return { error: t.validation.notFound };

  const inUse = item._count.reviews > 0;
  await recordChangeAs(
    user.name,
    { module: t.nav.evaluation, action: t.auditActions.deleteEvaluationScaleItem, oldValue: item.label, newValue: inUse ? t.evaluation.settings.inUse : "-" },
    (tx) => (inUse ? tx.evaluationScaleItem.update({ where: { id }, data: { deletedAt: new Date() } }) : tx.evaluationScaleItem.delete({ where: { id } })),
  );
  revalidatePath("/settings");
  revalidatePath("/evaluation");
  return { success: true, message: t.evaluation.settings.deleted };
}
