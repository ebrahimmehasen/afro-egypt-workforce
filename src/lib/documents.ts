import { EMPLOYEE_DOCUMENT_TYPES, EmployeeDocument, EmployeeDocumentType } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

/** Document types this employee has not uploaded yet. */
export function missingDocumentTypes(docs: EmployeeDocument[]): EmployeeDocumentType[] {
  const present = new Set(docs.map((d) => d.type));
  return EMPLOYEE_DOCUMENT_TYPES.filter((t) => !present.has(t));
}

export function documentsComplete(docs: EmployeeDocument[]): boolean {
  return missingDocumentTypes(docs).length === 0;
}

export function documentTypeLabel(type: EmployeeDocumentType, t: Dictionary): string {
  return t.documents.types[type];
}

/** Accepted upload MIME types + the max size (bytes). Shared by the client input and the API route. */
export const ACCEPTED_DOCUMENT_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8 MB
