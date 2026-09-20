import {
  EMPLOYEE_DOCUMENT_TYPES,
  REQUIRED_EMPLOYEE_DOCUMENT_TYPES,
  EmployeeDocument,
  EmployeeDocumentType,
} from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

// Client-safe (imported by documents-panel.tsx / acknowledgments-panel.tsx) —
// no Node built-ins here. Server-only storage paths live in
// @/lib/document-storage instead.

/** "Other" is a catch-all shelf, not a document anyone can be missing. */
export function canBeRequired(type: EmployeeDocumentType): boolean {
  return type !== "other";
}

/** Reads the stored JSON, keeping only known, requirable types. `undefined` = the company default. */
export function parseRequiredDocuments(raw: unknown): EmployeeDocumentType[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return EMPLOYEE_DOCUMENT_TYPES.filter((t) => canBeRequired(t) && raw.includes(t));
}

/** The document types this employee must have on file — their own list, otherwise the company default. */
export function requiredDocumentTypes(employee: { requiredDocuments?: EmployeeDocumentType[] }): EmployeeDocumentType[] {
  return employee.requiredDocuments ?? REQUIRED_EMPLOYEE_DOCUMENT_TYPES;
}

/**
 * The required list after moving `type` in or out of it. Returns `null` when the
 * result is the company default again, so an employee only carries a custom list
 * while they actually differ from it.
 */
export function withRequirement(
  current: EmployeeDocumentType[],
  type: EmployeeDocumentType,
  required: boolean,
): EmployeeDocumentType[] | null {
  const set = new Set(current);
  if (required) set.add(type);
  else set.delete(type);
  const isDefault =
    set.size === REQUIRED_EMPLOYEE_DOCUMENT_TYPES.length && REQUIRED_EMPLOYEE_DOCUMENT_TYPES.every((t) => set.has(t));
  return isDefault ? null : EMPLOYEE_DOCUMENT_TYPES.filter((t) => set.has(t));
}

/** Required document types nothing is filed under yet — against `required`, else the company default. */
export function missingDocumentTypes(
  docs: EmployeeDocument[],
  required: EmployeeDocumentType[] = REQUIRED_EMPLOYEE_DOCUMENT_TYPES,
): EmployeeDocumentType[] {
  const present = new Set(docs.map((d) => d.type));
  return required.filter((t) => !present.has(t));
}

export function documentsComplete(
  docs: EmployeeDocument[],
  required: EmployeeDocumentType[] = REQUIRED_EMPLOYEE_DOCUMENT_TYPES,
): boolean {
  return missingDocumentTypes(docs, required).length === 0;
}

export function documentTypeLabel(type: EmployeeDocumentType, t: Dictionary): string {
  return t.documents.types[type];
}

/** Accepted upload MIME types + the max size (bytes). Shared by the client input and the API route. */
export const ACCEPTED_DOCUMENT_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8 MB
