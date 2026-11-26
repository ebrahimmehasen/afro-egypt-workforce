import path from "node:path";
import { CASE_PHOTO_TYPES, CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";

/**
 * Case photos are personal data: stored OUTSIDE `public/`, under random names, and read back only by the authenticated,
 * department-scoped route src/app/api/case-proof/[id]/photo. Server-only (node:path).
 */
export const CASE_PROOF_STORAGE_ROOT = path.join(process.cwd(), "storage", "uploads", "case-proof");

export type PhotoCheck = { ok: true; ext: string; mime: string } | { ok: false; error: "type" | "size" | "empty" };

/** The declared type must be allowed AND the file's first bytes must be that type's signature. */
export function checkCasePhoto(declaredMime: string, bytes: Uint8Array): PhotoCheck {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > L.maxPhotoBytes) return { ok: false, error: "size" };
  const kind = CASE_PHOTO_TYPES.find((k) => k.mime === declaredMime);
  if (!kind) return { ok: false, error: "type" };
  const startsRight = kind.magic.every((b, i) => bytes[i] === b);
  const webpTag = "magicAt8" in kind ? kind.magicAt8.every((b, i) => bytes[8 + i] === b) : true;
  return startsRight && webpTag ? { ok: true, ext: kind.ext, mime: kind.mime } : { ok: false, error: "type" };
}
