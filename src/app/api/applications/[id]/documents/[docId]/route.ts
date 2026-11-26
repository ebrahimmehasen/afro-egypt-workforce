import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canManageApplications } from "@/lib/permissions";
import { APPLICATION_FILE_TYPES } from "@/lib/recruitment/config";
import { APPLICATION_STORAGE_ROOT } from "@/lib/recruitment/files";

/**
 * GET /api/applications/:id/documents/:docId — an applicant's certificate, for the admin or HR only. Never a static file: the
 * physical path is built from the database row (a random key), never from the request, and the file is always sent as a
 * download with a fixed, allow-listed type so a browser never renders or runs it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageApplications(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, docId } = await params;
  // scoped to this application, so a valid document id from another application is not served under this one
  const doc = await prisma.applicationDocument.findFirst({ where: { id: docId, applicationId: id } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const kind = APPLICATION_FILE_TYPES.find((k) => k.mime === doc.mimeType);
  if (!kind) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const bytes = await readFile(path.join(APPLICATION_STORAGE_ROOT, path.basename(doc.storageKey)));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": kind.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  }
}
