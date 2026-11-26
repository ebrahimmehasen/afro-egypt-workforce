"use server";

import { unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";
import { canUseCaseProof } from "@/lib/case-proof/access";
import { canEditCaseProof, loadCaseProof } from "@/lib/case-proof/data";
import { CASE_PROOF_STORAGE_ROOT } from "@/lib/case-proof/files";

// Saving, editing and discarding a case. Admin, or a department supervisor for a case about someone in his departments (and
// only the one who made a case, or the admin, changes its text). Each change writes its audit entry with the old and new text
// in the same transaction. None of it touches attendance, payroll, deductions or any pay rule.

async function authorize() {
  const [user, t] = await Promise.all([getSession(), getT()]);
  return { user: user && canUseCaseProof(user) ? user : null, t };
}

function refresh(employeeId?: string) {
  revalidatePath("/case-proof");
  if (employeeId) revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/audit-log");
}

/** Save the description (the AI draft as edited, or what the supervisor wrote). Used for the first save and for later edits. */
export async function saveCaseProof(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, t } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 3 || text.length > L.maxTextLength) return { error: t.caseProof.errors.textRequired, fields: ["text"] };

  const row = await loadCaseProof(user, id);
  if (!row) return { error: t.caseProof.errors.notFound };
  if (!canEditCaseProof(user, row.createdById)) return { error: t.validation.notAllowed };

  const first = row.status === "draft";
  await recordChangeAs(
    user.name,
    {
      module: t.caseProof.title,
      action: first ? t.auditActions.saveCaseProof : t.auditActions.editCaseProof,
      // what it said before: the previous text, or (first save) the AI draft it started from
      oldValue: row.finalText ?? row.aiDraft ?? "-",
      newValue: text,
      reason: `${row.employee.name} (${row.employee.employeeNumber}) — ${row.employee.department.name}`,
    },
    (tx) => tx.caseProof.update({ where: { id }, data: { finalText: text, status: "saved", savedAt: row.savedAt ?? new Date() } }),
  );
  refresh(row.employeeId);
  return { success: true, message: t.caseProof.saved };
}

/** Discard a case that was never saved: its row and its photo go. A saved case is a record and cannot be discarded. */
export async function discardCaseProof(id: string): Promise<ActionState> {
  const { user, t } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const row = await loadCaseProof(user, id);
  if (!row) return { error: t.caseProof.errors.notFound };
  if (!canEditCaseProof(user, row.createdById)) return { error: t.validation.notAllowed };
  if (row.status !== "draft") return { error: t.caseProof.errors.locked };

  await recordChangeAs(
    user.name,
    { module: t.caseProof.title, action: t.auditActions.discardCaseProof, oldValue: `${row.employee.name} — ${row.aiDraft ?? "-"}`, reason: user.name },
    (tx) => tx.caseProof.delete({ where: { id } }),
  );
  await unlink(path.join(CASE_PROOF_STORAGE_ROOT, path.basename(row.photoKey))).catch(() => undefined);
  refresh(row.employeeId);
  return { success: true, message: t.caseProof.discarded };
}
