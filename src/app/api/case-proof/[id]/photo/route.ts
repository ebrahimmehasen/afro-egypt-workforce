import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { CASE_PHOTO_TYPES } from "@/lib/case-proof/config";
import { canUseCaseProof } from "@/lib/case-proof/access";
import { loadCaseProof } from "@/lib/case-proof/data";
import { CASE_PROOF_STORAGE_ROOT } from "@/lib/case-proof/files";

/**
 * GET /api/case-proof/:id/photo — the photo of a case, for the admin or the supervisor of the employee's department only (the
 * same scoping as the case itself). Never a static file: the physical path is built from the database row (a random key),
 * never from the request, and the type is fixed from an allow-list. A case outside the viewer's departments answers 404, the
 * same as one that does not exist.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canUseCaseProof(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const row = await loadCaseProof(user, id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const kind = CASE_PHOTO_TYPES.find((k) => k.mime === row.photoMime);
  if (!kind) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const bytes = await readFile(path.join(CASE_PROOF_STORAGE_ROOT, path.basename(row.photoKey)));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": kind.mime,
        "Content-Disposition": `inline; filename="case-${row.id}.${kind.ext}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  }
}
