import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canCorrectAttendance } from "@/lib/permissions";
import { recordChangeAs } from "@/lib/audit";
import { acknowledgmentTypeLabel } from "@/lib/acknowledgments";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { getT } from "@/lib/i18n";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads", "employees");

/** POST /api/employees/:id/acknowledgments — multipart { ackId, file } (signed PDF scan) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || !canCorrectAttendance(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const t = await getT();
  const form = await req.formData();
  const ackId = String(form.get("ackId") ?? "");
  const file = form.get("file");

  const ack = await prisma.employeeAcknowledgment.findFirst({ where: { id: ackId, employeeId: id } });
  if (!ack) return NextResponse.json({ error: "acknowledgment not found" }, { status: 404 });

  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "signed acknowledgment must be a PDF" }, { status: 415 });
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const dir = path.join(UPLOAD_ROOT, id, "acknowledgments");
  await mkdir(dir, { recursive: true });
  const filename = `${ack.type}-${Date.now()}.pdf`;
  const fileUrl = `/uploads/employees/${id}/acknowledgments/${filename}`;
  await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

  try {
    await recordChangeAs(
      user.name,
      {
        module: t.nav.employees,
        action: t.acknowledgments.auditUploadSigned,
        oldValue: ack.signedAt ? ack.fileName ?? "-" : "-",
        newValue: `${acknowledgmentTypeLabel(ack.type, t)} — ${file.name}`,
        reason: id,
      },
      (tx) =>
        tx.employeeAcknowledgment.update({
          where: { id: ack.id },
          data: { fileUrl, fileName: file.name, signedAt: new Date() },
        }),
    );
    if (ack.fileUrl && ack.fileUrl !== fileUrl) {
      await unlink(path.join(process.cwd(), "public", ack.fileUrl)).catch(() => {});
    }
  } catch {
    await unlink(path.join(dir, filename)).catch(() => {});
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fileUrl });
}
