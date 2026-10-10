import path from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import sharp from "sharp";
import { DOCUMENT_STORAGE_ROOT } from "@/lib/document-storage";

/**
 * Small square previews of uploaded photos (the personal-photo avatar in the
 * employees list). Showing the full upload there would ship the original —
 * up to 8 MB — once per row on every page load.
 *
 * The thumbnail is cached on disk right next to the original, as
 * `<original>.thumb.webp`. It is built the first time it is asked for, so
 * photos uploaded before this existed need no migration. An upload is never
 * edited in place (each upload gets a new file), so a cached thumbnail never
 * goes stale. Server-only: uses `sharp` and the private document storage.
 */
const THUMB_SIZE = 96; // shown at 32px; the extra pixels keep it sharp on high-density screens

export const THUMBNAIL_CONTENT_TYPE = "image/webp";

function thumbnailPath(storageKey: string): string {
  return `${path.join(DOCUMENT_STORAGE_ROOT, storageKey)}.thumb.webp`;
}

/** The thumbnail for the stored image at `storageKey`; builds and caches it on first use. */
export async function getDocumentThumbnail(storageKey: string): Promise<Buffer> {
  const cached = thumbnailPath(storageKey);
  try {
    return await readFile(cached);
  } catch {
    // not built yet — fall through
  }

  const thumb = await sharp(path.join(DOCUMENT_STORAGE_ROOT, storageKey))
    .rotate() // honour the camera's EXIF orientation so phone photos aren't sideways
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover", position: "attention" })
    .webp({ quality: 80 })
    .toBuffer();
  await writeFile(cached, thumb).catch(() => {}); // the cache is an optimisation, never a requirement
  return thumb;
}

/** Drops the cached thumbnail of a file that is being deleted (best effort). */
export async function removeDocumentThumbnail(storageKey: string): Promise<void> {
  await unlink(thumbnailPath(storageKey)).catch(() => {});
}
