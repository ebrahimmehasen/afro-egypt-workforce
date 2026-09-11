import path from "node:path";

/**
 * Employee files (ID cards, contracts, signed acknowledgments) are sensitive —
 * stored OUTSIDE `public/`, never served as a static asset. The only way to
 * read one back is the scope-checked GET handler on the same API routes that
 * accept the upload (see `app/api/employees/[id]/documents` and
 * `.../acknowledgments`), which resolves the physical path from the database
 * row rather than trusting anything in the request.
 *
 * Server-only (uses `node:path`) — kept out of @/lib/documents, which is
 * imported by client components and must stay bundleable for the browser.
 */
export const DOCUMENT_STORAGE_ROOT = path.join(process.cwd(), "storage", "uploads", "employees");
