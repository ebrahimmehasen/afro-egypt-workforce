import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canManageEmployeeFiles } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { recordChangeAs } from "@/lib/audit";
import { isCustomAcknowledgmentKey, isStandardAcknowledgmentKey } from "@/lib/acknowledgments";
import { ACCEPTED_DOCUMENT_MIME, MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { DOCUMENT_STORAGE_ROOT } from "@/lib/document-storage";
import { getT } from "@/lib/i18n";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * GET /api/employees/:id/acknowledgments?key=... — streams the file back.
 * Same scope check and DB-resolved-path discipline as the documents route.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canViewEmployee(user, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!isStandardAcknowledgmentKey(key) && !isCustomAcknowledgmentKey(key)) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  const ack = await prisma.employeeAcknowledgment.findUnique({
    where: { employeeId_key: { employeeId: id, key } },
  });
  if (!ack) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const bytes = await readFile(path.join(DOCUMENT_STORAGE_ROOT, ack.fileUrl));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": ack.mimeType ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(ack.fileName ?? "file")}"`,
        "Cache-Control": "private, max-age=0, no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  }
}

/**
 * POST /api/employees/:id/acknowledgments — multipart { key, file, label? }
 *   key = one of the three standard keys, OR "new" to create a custom slot
 *         (then `label` is required), OR an existing "custom-…" key to replace it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canManageEmployeeFiles(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const t = await getT();
  const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  let key = String(form.get("key") ?? "");
  const label = String(form.get("label") ?? "").trim();

  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (!ACCEPTED_DOCUMENT_MIME.includes(file.type)) {
    return NextResponse.json({ error: "unsupported file type" }, { status: 415 });
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  let resolvedLabel: string;
  if (key === "new") {
    if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
    key = `custom-${randomUUID()}`;
    resolvedLabel = label;
  } else if (isStandardAcknowledgmentKey(key)) {
    resolvedLabel = t.acknowledgments.slots[key];
  } else if (isCustomAcknowledgmentKey(key)) {
    const existing = await prisma.employeeAcknowledgment.findUnique({
      where: { employeeId_key: { employeeId: id, key } },
    });
    if (!existing) return NextResponse.json({ error: "slot not found" }, { status: 404 });
    resolvedLabel = label || existing.label;
  } else {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  const dir = path.join(DOCUMENT_STORAGE_ROOT, id, "acknowledgments");
  await mkdir(dir, { recursive: true });
  const filename = `${key}-${Date.now()}.${EXT_BY_MIME[file.type]}`;
  const storageKey = path.posix.join(id, "acknowledgments", filename);
  await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

  try {
    const prev = await prisma.employeeAcknowledgment.findUnique({
      where: { employeeId_key: { employeeId: id, key } },
    });
    await recordChangeAs(
      user.name,
      {
        module: t.nav.employees,
        action: t.acknowledgments.auditUpload,
        oldValue: prev?.fileName ?? "-",
        newValue: `${resolvedLabel} — ${file.name}`,
        reason: `${employee.name} (${id})`,
      },
      (tx) =>
        tx.employeeAcknowledgment.upsert({
          where: { employeeId_key: { employeeId: id, key } },
          create: {
            employeeId: id, key, label: resolvedLabel,
            fileUrl: storageKey, fileName: file.name, mimeType: file.type, uploadedBy: user.name,
          },
          update: {
            label: resolvedLabel,
            fileUrl: storageKey, fileName: file.name, mimeType: file.type, uploadedBy: user.name, uploadedAt: new Date(),
          },
        }),
    );
    if (prev && prev.fileUrl !== storageKey) {
      await unlink(path.join(DOCUMENT_STORAGE_ROOT, prev.fileUrl)).catch(() => {});
    }
  } catch {
    await unlink(path.join(dir, filename)).catch(() => {});
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, key });
}

/** DELETE /api/employees/:id/acknowledgments?key=... */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canManageEmployeeFiles(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const t = await getT();
  const key = String(req.nextUrl.searchParams.get("key") ?? "");

  const ack = await prisma.employeeAcknowledgment.findUnique({
    where: { employeeId_key: { employeeId: id, key } },
  });
  if (!ack) return NextResponse.json({ error: "not found" }, { status: 404 });

  await recordChangeAs(
    user.name,
    {
      module: t.nav.employees,
      action: t.acknowledgments.auditDelete,
      oldValue: `${ack.label} — ${ack.fileName ?? ""}`,
      reason: id,
    },
    (tx) => tx.employeeAcknowledgment.delete({ where: { id: ack.id } }),
  );
  await unlink(path.join(DOCUMENT_STORAGE_ROOT, ack.fileUrl)).catch(() => {});

  return NextResponse.json({ ok: true });
}
