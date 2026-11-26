"use server";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { User } from "@/lib/types";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";
import { canUseCaseProof } from "@/lib/case-proof/access";
import { canEditCaseProof, loadCaseProof } from "@/lib/case-proof/data";
import { CASE_PROOF_STORAGE_ROOT, checkCasePhoto } from "@/lib/case-proof/files";
import { requestCaseSetDraft } from "@/lib/case-proof/ai-draft";

// Saving, editing and discarding a case. Admin, or a department supervisor for a case about someone in his departments (and
// only the one who made a case, or the admin, changes its text). Each change writes its audit entry with the old and new text
// in the same transaction. None of it touches attendance, payroll, deductions or any pay rule.

async function authorize() {
  const [user, t] = await Promise.all([getSession(), getT()]);
  return { user: user && canUseCaseProof(user) ? user : null, t };
}

/** "Name (number) — Department" for each employee the case is attached to, for the audit entry. */
const namesOf = (employees: { name: string; employeeNumber: string; departmentName: string }[]) => employees.map((e) => `${e.name} (${e.employeeNumber}) — ${e.departmentName}`).join("؛ ");

/** The employee profile page is keyed by the employee NUMBER in its URL (/employees/ACC-001). */
function refresh(employeeNumbers: string[] = []) {
  revalidatePath("/case-proof");
  for (const number of employeeNumbers) revalidatePath(`/employees/${number}`);
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
      reason: namesOf(row.employees),
    },
    (tx) => tx.caseProof.update({ where: { id }, data: { finalText: text, status: "saved", savedAt: row.savedAt ?? new Date() } }),
  );
  refresh(row.employees.map((e) => e.employeeNumber));
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
    { module: t.caseProof.title, action: t.auditActions.discardCaseProof, oldValue: `${row.employees.map((e) => e.name).join("، ")} — ${row.aiDraft ?? "-"}`, reason: user.name },
    (tx) => tx.caseProof.delete({ where: { id } }),
  );
  await unlink(path.join(CASE_PROOF_STORAGE_ROOT, path.basename(row.photoKey))).catch(() => undefined);
  refresh(row.employees.map((e) => e.employeeNumber));
  return { success: true, message: t.caseProof.discarded };
}

// Adding or removing a photo. Both re-ask the AI for ONE combined draft of the case's FULL current set of photos (never just
// the one changed) and store it as `aiDraft` — `finalText`, the supervisor's own record, is never touched by this path. Same
// authorization as saveCaseProof/discardCaseProof: the admin, or the supervisor who made the case.

export interface PhotoActionResult extends ActionState {
  photos?: { id: string; position: number }[];
  /** The refreshed combined AI draft (a suggestion only — never the record), or null when the AI was not available. */
  draft?: string | null;
  aiAvailable?: boolean;
}

/** Re-reads every current photo of the case from disk and stores ONE fresh combined draft. A failed AI call clears the
 * draft (never a made-up or now-outdated one) rather than leaving a stale description of a set that has since changed. */
async function refreshSetDraft(id: string, user: User, department: string, locale: "ar" | "en"): Promise<{ draft: string | null; aiAvailable: boolean }> {
  const rows = await prisma.caseProofPhoto.findMany({ where: { caseProofId: id }, orderBy: { position: "asc" } });
  const images = await Promise.all(
    rows.map(async (p) => ({ mime: p.photoMime, bytes: new Uint8Array(await readFile(path.join(CASE_PROOF_STORAGE_ROOT, path.basename(p.photoKey)))) })),
  );
  const draft = await requestCaseSetDraft({ images, context: { department, uploader: user.name, locale } }).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
  await prisma.caseProof.update({ where: { id }, data: { aiDraft: draft.ok ? draft.text : null, aiGenerated: draft.ok } });
  return { draft: draft.ok ? draft.text : null, aiAvailable: draft.ok };
}

/** Add one or more photos ("photo" fields on `formData`) to an existing case, up to the per-case limit. Every photo is
 * checked exactly as on upload; one bad photo refuses the whole call, with nothing partially stored. */
export async function addCaseProofPhotos(id: string, formData: FormData): Promise<PhotoActionResult> {
  const { user, t } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const row = await loadCaseProof(user, id);
  if (!row) return { error: t.caseProof.errors.notFound };
  if (!canEditCaseProof(user, row.createdById)) return { error: t.validation.notAllowed };

  const files = formData.getAll("photo").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { error: t.caseProof.errors.empty };
  if (row.photos.length + files.length > L.maxPhotosPerCase) return { error: t.caseProof.errors.tooManyPhotos };

  const checked: { bytes: Uint8Array; ext: string; mime: string }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = checkCasePhoto(file.type, bytes);
    if (!result.ok) return { error: result.error === "size" ? t.caseProof.errors.size : result.error === "type" ? t.caseProof.errors.type : t.caseProof.errors.empty };
    checked.push({ bytes, ext: result.ext, mime: result.mime });
  }

  await mkdir(CASE_PROOF_STORAGE_ROOT, { recursive: true });
  const written: string[] = [];
  const nextPosition = row.photos.length ? Math.max(...row.photos.map((p) => p.position)) + 1 : 0;
  try {
    for (const p of checked) {
      const key = `${randomUUID()}.${p.ext}`;
      await writeFile(path.join(CASE_PROOF_STORAGE_ROOT, key), p.bytes, { flag: "wx" });
      written.push(key);
    }
    await prisma.caseProofPhoto.createMany({
      data: written.map((key, i) => ({ caseProofId: id, photoKey: key, photoMime: checked[i].mime, photoSize: checked[i].bytes.length, position: nextPosition + i })),
    });
  } catch (error) {
    await Promise.all(written.map((key) => unlink(path.join(CASE_PROOF_STORAGE_ROOT, key)).catch(() => undefined)));
    throw error;
  }

  const departmentNames = [...new Set(row.employees.map((e) => e.departmentName))].join(", ");
  const { draft, aiAvailable } = await refreshSetDraft(id, user, departmentNames, await getLocale());
  const photos = await prisma.caseProofPhoto.findMany({ where: { caseProofId: id }, select: { id: true, position: true }, orderBy: { position: "asc" } });
  refresh(row.employees.map((e) => e.employeeNumber));
  return { success: true, photos, draft, aiAvailable };
}

/** Remove one photo of a case. A case must keep at least one photo: removing the last one is refused. */
export async function removeCaseProofPhoto(id: string, photoId: string): Promise<PhotoActionResult> {
  const { user, t } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const row = await loadCaseProof(user, id);
  if (!row) return { error: t.caseProof.errors.notFound };
  if (!canEditCaseProof(user, row.createdById)) return { error: t.validation.notAllowed };
  if (row.photos.length <= 1) return { error: t.caseProof.errors.minOnePhoto };
  const photo = await prisma.caseProofPhoto.findFirst({ where: { id: photoId, caseProofId: id } });
  if (!photo) return { error: t.caseProof.errors.notFound };

  await prisma.caseProofPhoto.delete({ where: { id: photoId } });
  await unlink(path.join(CASE_PROOF_STORAGE_ROOT, path.basename(photo.photoKey))).catch(() => undefined);

  const departmentNames = [...new Set(row.employees.map((e) => e.departmentName))].join(", ");
  const { draft, aiAvailable } = await refreshSetDraft(id, user, departmentNames, await getLocale());
  const photos = await prisma.caseProofPhoto.findMany({ where: { caseProofId: id }, select: { id: true, position: true }, orderBy: { position: "asc" } });
  refresh(row.employees.map((e) => e.employeeNumber));
  return { success: true, photos, draft, aiAvailable };
}
