import { describe, expect, it } from "vitest";
import { documentsComplete, missingDocumentTypes } from "@/lib/documents";
import {
  OPTIONAL_EMPLOYEE_DOCUMENT_TYPES,
  REQUIRED_EMPLOYEE_DOCUMENT_TYPES,
  EmployeeDocument,
} from "@/lib/types";

const doc = (type: EmployeeDocument["type"]): EmployeeDocument => ({
  id: `d-${type}`,
  employeeId: "EMP-1",
  type,
  fileUrl: `/uploads/employees/EMP-1/documents/${type}-1.jpg`,
  uploadedAt: "2026-09-06T10:00:00.000Z",
});

describe("missingDocumentTypes", () => {
  it("lists every required type when nothing is uploaded", () => {
    expect(missingDocumentTypes([])).toEqual(REQUIRED_EMPLOYEE_DOCUMENT_TYPES);
    expect(documentsComplete([])).toBe(false);
  });

  it("returns only the required types still missing", () => {
    const have = [doc("national_id_photo"), doc("birth_certificate")];
    const missing = missingDocumentTypes(have);
    expect(missing).not.toContain("national_id_photo");
    expect(missing).not.toContain("birth_certificate");
    expect(missing).toHaveLength(REQUIRED_EMPLOYEE_DOCUMENT_TYPES.length - 2);
  });

  it("is complete once every required type is present", () => {
    const all = REQUIRED_EMPLOYEE_DOCUMENT_TYPES.map(doc);
    expect(missingDocumentTypes(all)).toEqual([]);
    expect(documentsComplete(all)).toBe(true);
  });

  it("never demands an optional type", () => {
    const missing = missingDocumentTypes([]);
    for (const optional of OPTIONAL_EMPLOYEE_DOCUMENT_TYPES) {
      expect(missing).not.toContain(optional);
    }
    // uploading optional extras alone still leaves the file incomplete
    expect(documentsComplete(OPTIONAL_EMPLOYEE_DOCUMENT_TYPES.map(doc))).toBe(false);
  });

  it("ignores duplicate types", () => {
    expect(missingDocumentTypes([doc("national_id_photo"), doc("national_id_photo")])).toHaveLength(
      REQUIRED_EMPLOYEE_DOCUMENT_TYPES.length - 1,
    );
  });
});
