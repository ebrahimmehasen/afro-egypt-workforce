import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canCorrectAttendance } from "@/lib/permissions";
import { recordChangeAs } from "@/lib/audit";
import { getT } from "@/lib/i18n";
import {
  ACCEPTED_DOCUMENT_MIME,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents";
import { EMPLOYEE_DOCUMENT_TYPES, EmployeeDocumentType } from "@/lib/types";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads", "employees");

/** POST /api/employees/:id/documents — multipart { file, type } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canCorrectAttendance(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const t = await getT();
  const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  const type = String(form.get("type") ?? "") as EmployeeDocumentType;

  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (!EMPLOYEE_DOCUMENT_TYPES.includes(type)) {
    return NextResponse.json({ error: "invalid document type" }, { status: 400 });
  }
  if (!ACCEPTED_DOCUMENT_MIME.includes(file.type)) {
    return NextResponse.json({ error: "unsupported file type" }, { status: 415 });
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const dir = path.join(UPLOAD_ROOT, id, "documents");
  await mkdir(dir, { recursive: true });
  const filename = `${type}-${Date.now()}.${EXT_BY_MIME[file.type]}`;
  const absPath = path.join(dir, filename);
  const fileUrl = `/uploads/employees/${id}/documents/${filename}`;

  await writeFile(absPath, Buffer.from(await file.arrayBuffer()));

  try {
    const existing = await prisma.employeeDocument.findUnique({
      where: { employeeId_type: { employeeId: id, type } },
    });

    await recordChangeAs(
      user.name,
      {
        module: t.nav.employees,
        action: t.documents.auditUpload,
        oldValue: existing?.fileName ?? "-",
        newValue: `${t.documents.types[type]} — ${file.name}`,
        reason: `${employee.name} (${id})`,
      },
      (tx) =>
        tx.employeeDocument.upsert({
          where: { employeeId_type: { employeeId: id, type } },
          create: { employeeId: id, type, fileUrl, fileName: file.name, mimeType: file.type, uploadedBy: user.name },
          update: { fileUrl, fileName: file.name, mimeType: file.type, uploadedBy: user.name, uploadedAt: new Date() },
        }),
    );

    // replaced an older file — remove it (best effort)
    if (existing && existing.fileUrl !== fileUrl) {
      await unlink(path.join(process.cwd(), "public", existing.fileUrl)).catch(() => {});
    }
  } catch (err) {
    await unlink(absPath).catch(() => {});
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fileUrl, type });
}

/** DELETE /api/employees/:id/documents?type=... */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canCorrectAttendance(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const t = await getT();
  const type = String(req.nextUrl.searchParams.get("type") ?? "") as EmployeeDocumentType;
  if (!EMPLOYEE_DOCUMENT_TYPES.includes(type)) {
    return NextResponse.json({ error: "invalid document type" }, { status: 400 });
  }

  const doc = await prisma.employeeDocument.findUnique({
    where: { employeeId_type: { employeeId: id, type } },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  await recordChangeAs(
    user.name,
    {
      module: t.nav.employees,
      action: t.documents.auditDelete,
      oldValue: `${t.documents.types[type]} — ${doc.fileName ?? ""}`,
      reason: id,
    },
    (tx) => tx.employeeDocument.delete({ where: { id: doc.id } }),
  );
  await unlink(path.join(process.cwd(), "public", doc.fileUrl)).catch(() => {});

  return NextResponse.json({ ok: true });
}
