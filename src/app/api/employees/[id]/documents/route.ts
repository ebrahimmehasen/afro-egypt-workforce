import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canManageEmployeeFiles } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { recordChangeAs } from "@/lib/audit";
import { getT } from "@/lib/i18n";
import { ACCEPTED_DOCUMENT_MIME, MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { DOCUMENT_STORAGE_ROOT } from "@/lib/document-storage";
import { EMPLOYEE_DOCUMENT_TYPES, EmployeeDocumentType } from "@/lib/types";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * GET /api/employees/:id/documents?docId=... — streams the file back.
 * Scope-checked (same rule as the /employees/[id] page): admin/hr see anyone,
 * a supervisor only their department, an employee only themselves. The
 * physical path is read from the database row, never from the request.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canViewEmployee(user, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const docId = req.nextUrl.searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "missing docId" }, { status: 400 });

  // Scoped to this employee so a valid id from another employee's file can't be read.
  const doc = await prisma.employeeDocument.findFirst({ where: { id: docId, employeeId: id } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const bytes = await readFile(path.join(DOCUMENT_STORAGE_ROOT, doc.fileUrl));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mimeType ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName ?? "file")}"`,
        "Cache-Control": "private, max-age=0, no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  }
}

/** POST /api/employees/:id/documents — multipart { file, type } */
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

  const dir = path.join(DOCUMENT_STORAGE_ROOT, id, "documents");
  await mkdir(dir, { recursive: true });
  const filename = `${type}-${Date.now()}.${EXT_BY_MIME[file.type]}`;
  const absPath = path.join(dir, filename);
  // Stored in the DB as a path relative to DOCUMENT_STORAGE_ROOT — never a public URL.
  const storageKey = path.posix.join(id, "documents", filename);

  await writeFile(absPath, Buffer.from(await file.arrayBuffer()));

  try {
    await recordChangeAs(
      user.name,
      {
        module: t.nav.employees,
        action: t.documents.auditUpload,
        newValue: `${t.documents.types[type]} — ${file.name}`,
        reason: `${employee.name} (${employee.employeeNumber})`,
      },
      (tx) =>
        tx.employeeDocument.create({
          data: { employeeId: id, type, fileUrl: storageKey, fileName: file.name, mimeType: file.type, uploadedBy: user.name },
        }),
    );
  } catch {
    await unlink(absPath).catch(() => {});
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type });
}

/** DELETE /api/employees/:id/documents?docId=... */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canManageEmployeeFiles(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const t = await getT();
  const docId = req.nextUrl.searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "missing docId" }, { status: 400 });

  const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const doc = await prisma.employeeDocument.findFirst({ where: { id: docId, employeeId: id } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  await recordChangeAs(
    user.name,
    {
      module: t.nav.employees,
      action: t.documents.auditDelete,
      oldValue: `${t.documents.types[doc.type]} — ${doc.fileName ?? ""}`,
      reason: `${employee.name} (${employee.employeeNumber})`,
    },
    (tx) => tx.employeeDocument.delete({ where: { id: doc.id } }),
  );
  await unlink(path.join(DOCUMENT_STORAGE_ROOT, doc.fileUrl)).catch(() => {});

  return NextResponse.json({ ok: true });
}
