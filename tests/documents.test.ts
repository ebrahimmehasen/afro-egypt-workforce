import { describe, expect, it } from "vitest";
import { documentsComplete, missingDocumentTypes } from "@/lib/documents";
import { EMPLOYEE_DOCUMENT_TYPES, EmployeeDocument } from "@/lib/types";

const doc = (type: EmployeeDocument["type"]): EmployeeDocument => ({
  id: `d-${type}`,
  employeeId: "EMP-1",
  type,
  fileUrl: `/uploads/employees/EMP-1/documents/${type}-1.jpg`,
  uploadedAt: "2026-09-06T10:00:00.000Z",
});

describe("missingDocumentTypes", () => {
  it("lists every type when nothing is uploaded", () => {
    expect(missingDocumentTypes([])).toEqual(EMPLOYEE_DOCUMENT_TYPES);
    expect(documentsComplete([])).toBe(false);
  });

  it("returns only the types still missing", () => {
    const have = [doc("national_id_photo"), doc("cv")];
    const missing = missingDocumentTypes(have);
    expect(missing).not.toContain("national_id_photo");
    expect(missing).not.toContain("cv");
    expect(missing).toHaveLength(EMPLOYEE_DOCUMENT_TYPES.length - 2);
  });

  it("is complete once all seven types are present", () => {
    const all = EMPLOYEE_DOCUMENT_TYPES.map(doc);
    expect(missingDocumentTypes(all)).toEqual([]);
    expect(documentsComplete(all)).toBe(true);
  });

  it("ignores duplicate types", () => {
    expect(missingDocumentTypes([doc("cv"), doc("cv")])).toHaveLength(EMPLOYEE_DOCUMENT_TYPES.length - 1);
  });
});
