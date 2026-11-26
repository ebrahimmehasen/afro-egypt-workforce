import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { recordChangeAs } from "@/lib/audit";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { takeSlot } from "@/lib/assistant/rate-limit";
import { CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";
import { canUseCaseProof, canUseEmployee } from "@/lib/case-proof/access";
import { CASE_PROOF_STORAGE_ROOT, checkCasePhoto } from "@/lib/case-proof/files";
import { requestCaseDraft } from "@/lib/case-proof/ai-draft";

/**
 * POST /api/case-proof — multipart { employeeId, photo }. Admin, or a department supervisor for an employee in a department
 * on his account; nobody else. Stores the photo (random name, private folder), creates the case as a DRAFT, asks the AI for a
 * draft description, and answers { id, draft, aiAvailable }. When the AI is not available the draft is null and the supervisor
 * writes the description himself: a description is never invented. Nothing here touches attendance, payroll or any pay rule.
 */
const uploads = new Map<string, number[]>();
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!canUseCaseProof(user)) return json({ error: "forbidden" }, 403);

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > L.maxRequestBytes) return json({ error: "tooLarge" }, 413);
  if (!takeSlot(uploads, user.id, Date.now(), L.uploadsPerUser, L.uploadsWindowMs)) return json({ error: "rateLimited" }, 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "generic" }, 400);
  }
  const employeeId = String(form.get("employeeId") ?? "");
  const photo = form.get("photo");
  if (!(photo instanceof File)) return json({ error: "empty" }, 400);

  const target = employeeId ? await canUseEmployee(user, employeeId) : { ok: false as const };
  if (!target.ok) return json({ error: "noEmployee" }, 403);

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const checked = checkCasePhoto(photo.type, bytes);
  if (!checked.ok) return json({ error: checked.error }, checked.error === "size" ? 413 : checked.error === "type" ? 415 : 400);

  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const department = await prisma.department.findUnique({ where: { id: target.departmentId }, select: { name: true } });

  await mkdir(CASE_PROOF_STORAGE_ROOT, { recursive: true });
  const photoKey = `${randomUUID()}.${checked.ext}`;
  await writeFile(path.join(CASE_PROOF_STORAGE_ROOT, photoKey), bytes, { flag: "wx" });
  let id: string;
  try {
    id = await recordChangeAs(
      user.name,
      { module: t.caseProof.title, action: t.auditActions.createCaseProof, newValue: `${target.name} — ${department?.name ?? ""}`, reason: user.name },
      async (tx) =>
        (
          await tx.caseProof.create({
            data: { employeeId, departmentId: target.departmentId, createdById: user.id, createdByName: user.name, photoKey, photoMime: checked.mime, photoSize: bytes.length },
          })
        ).id,
    );
  } catch (error) {
    await unlink(path.join(CASE_PROOF_STORAGE_ROOT, photoKey)).catch(() => undefined);
    throw error;
  }

  // the draft: asked once, never fatal. Whatever goes wrong, the case exists and the field is simply empty.
  const draft = await requestCaseDraft({
    image: { mime: checked.mime, bytes },
    context: { department: department?.name ?? "", uploader: user.name, employee: target.name, locale },
  }).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
  if (draft.ok) await prisma.caseProof.update({ where: { id }, data: { aiDraft: draft.text, aiGenerated: true } });

  return json({ id, draft: draft.ok ? draft.text : null, aiAvailable: draft.ok, reason: draft.ok ? undefined : draft.reason });
}
