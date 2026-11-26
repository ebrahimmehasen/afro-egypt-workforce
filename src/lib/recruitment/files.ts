import path from "node:path";
import { APPLICATION_FILE_TYPES, RECRUITMENT_LIMITS as L } from "@/lib/recruitment/config";

/**
 * Applicants' certificates are personal data from strangers: stored OUTSIDE `public/`, under random names, and read back only
 * by the authenticated download route (src/app/api/applications/[id]/documents/[docId]). Server-only (node:path).
 */
export const APPLICATION_STORAGE_ROOT = path.join(process.cwd(), "storage", "uploads", "applications");

export type FileCheck = { ok: true; ext: string; mime: string } | { ok: false; error: "type" | "size" | "empty" };

/** The declared type must be allowed AND the file's first bytes must be that type's signature — a renamed file is refused. */
export function checkApplicationFile(declaredMime: string, bytes: Uint8Array): FileCheck {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > L.maxFileBytes) return { ok: false, error: "size" };
  const kind = APPLICATION_FILE_TYPES.find((k) => k.mime === declaredMime);
  if (!kind || !kind.magic.every((b, i) => bytes[i] === b)) return { ok: false, error: "type" };
  return { ok: true, ext: kind.ext, mime: kind.mime };
}

/** A name that is safe to store and to show: no path, no control or markup characters, bounded. Only ever a label, never a path. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (cleaned || "file").slice(0, L.maxFileName);
}
