import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { recordChangeAs } from "@/lib/audit";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { prisma } from "@/lib/prisma";
import { takeSlot } from "@/lib/assistant/rate-limit";
import { CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";
import { canUseCaseProof, canUseEmployees } from "@/lib/case-proof/access";
import { CASE_PROOF_STORAGE_ROOT, checkCasePhoto } from "@/lib/case-proof/files";
import { requestCaseSetDraft } from "@/lib/case-proof/ai-draft";

/**
 * POST /api/case-proof — multipart { employeeId (one, or several), photo (one, or several — a phone's multi-picker included) }.
 * A case is attached to one employee or to a group. Admin, or a department supervisor when EVERY employee picked is in a
 * department on his account: if any one is outside (or unknown) the whole request is refused with 403 and nothing is created.
 * Every photo is checked (type, magic bytes, size) BEFORE any of them is written: one bad photo refuses the whole request, with
 * nothing stored. Stores the photos (random names, private folder, in the order picked), creates the case as a DRAFT with one
 * link per employee and one CaseProofPhoto per photo (the first also mirrored onto the case's own legacy columns, for
 * back-compat), asks the AI for ONE combined draft for the whole set (given the department(s) and the uploader, never an
 * employee name), and answers { id, draft, aiAvailable, photos }. When the AI is not available the draft is null and the
 * supervisor writes the description himself: a description is never invented. Nothing here touches attendance, payroll or any
 * pay rule.
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
  const employeeIds = [...new Set(form.getAll("employeeId").map(String).filter(Boolean))];
  const photos = form.getAll("photo").filter((f): f is File => f instanceof File);
  if (photos.length === 0) return json({ error: "empty" }, 400);
  if (photos.length > L.maxPhotosPerCase) return json({ error: "tooManyPhotos" }, 400);
  if (employeeIds.length > L.maxEmployeesPerCase) return json({ error: "tooManyEmployees" }, 400);

  // every employee picked must be inside the user's own departments; one outside refuses the whole request
  const target = employeeIds.length > 0 ? await canUseEmployees(user, employeeIds) : { ok: false as const };
  if (!target.ok) return json({ error: "noEmployee" }, 403);

  // every photo is read and checked before any of them is written: one bad photo refuses the whole upload, nothing partial
  const checkedPhotos: { bytes: Uint8Array; ext: string; mime: string }[] = [];
  for (const file of photos) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = checkCasePhoto(file.type, bytes);
    if (!checked.ok) return json({ error: checked.error }, checked.error === "size" ? 413 : checked.error === "type" ? 415 : 400);
    checkedPhotos.push({ bytes, ext: checked.ext, mime: checked.mime });
  }

  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const first = target.employees[0];
  const departmentNames = [...new Set(target.employees.map((e) => e.departmentName))];

  await mkdir(CASE_PROOF_STORAGE_ROOT, { recursive: true });
  const written: string[] = [];
  let id: string;
  let createdPhotos: { id: string; position: number }[];
  try {
    for (const p of checkedPhotos) {
      const key = `${randomUUID()}.${p.ext}`;
      await writeFile(path.join(CASE_PROOF_STORAGE_ROOT, key), p.bytes, { flag: "wx" });
      written.push(key);
    }
    const created = await recordChangeAs(
      user.name,
      { module: t.caseProof.title, action: t.auditActions.createCaseProof, newValue: `${target.employees.map((e) => e.name).join("، ")} — ${departmentNames.join("، ")}`, reason: user.name },
      (tx) =>
        tx.caseProof.create({
          data: {
            employeeId: first.id,
            departmentId: first.departmentId,
            createdById: user.id,
            createdByName: user.name,
            photoKey: written[0],
            photoMime: checkedPhotos[0].mime,
            photoSize: checkedPhotos[0].bytes.length,
            links: { create: target.employees.map((e) => ({ employeeId: e.id, departmentId: e.departmentId })) },
            photos: { create: written.map((key, i) => ({ photoKey: key, photoMime: checkedPhotos[i].mime, photoSize: checkedPhotos[i].bytes.length, position: i })) },
          },
          include: { photos: { select: { id: true, position: true }, orderBy: { position: "asc" } } },
        }),
    );
    id = created.id;
    createdPhotos = created.photos;
  } catch (error) {
    await Promise.all(written.map((key) => unlink(path.join(CASE_PROOF_STORAGE_ROOT, key)).catch(() => undefined)));
    throw error;
  }

  // the draft: asked once for the whole set, never fatal. Whatever goes wrong, the case exists and the field is simply empty.
  const draft = await requestCaseSetDraft({
    images: checkedPhotos.map((p) => ({ mime: p.mime, bytes: p.bytes })),
    context: { department: departmentNames.join(", "), uploader: user.name, locale },
  }).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
  if (draft.ok) await prisma.caseProof.update({ where: { id }, data: { aiDraft: draft.text, aiGenerated: true } });

  return json({ id, draft: draft.ok ? draft.text : null, aiAvailable: draft.ok, reason: draft.ok ? undefined : draft.reason, employees: target.employees.length, photos: createdPhotos });
}
