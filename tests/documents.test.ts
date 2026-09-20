import { describe, expect, it } from "vitest";
import {
  canBeRequired,
  documentsComplete,
  missingDocumentTypes,
  parseRequiredDocuments,
  requiredDocumentTypes,
  withRequirement,
} from "@/lib/documents";
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

describe("per-employee required documents", () => {
  it("falls back to the company default until a custom list is set", () => {
    expect(requiredDocumentTypes({})).toEqual(REQUIRED_EMPLOYEE_DOCUMENT_TYPES);
    expect(requiredDocumentTypes({ requiredDocuments: ["driving_license"] })).toEqual(["driving_license"]);
  });

  it("measures what's missing against the employee's own list", () => {
    const required = ["national_id_photo", "driving_license"] as const;
    expect(missingDocumentTypes([doc("national_id_photo")], [...required])).toEqual(["driving_license"]);
    expect(documentsComplete([doc("national_id_photo"), doc("driving_license")], [...required])).toBe(true);
  });

  it("moves a type into the required list", () => {
    const next = withRequirement(REQUIRED_EMPLOYEE_DOCUMENT_TYPES, "driving_license", true);
    expect(next).toContain("driving_license");
    expect(next).toHaveLength(REQUIRED_EMPLOYEE_DOCUMENT_TYPES.length + 1);
  });

  it("moves a type out of the required list", () => {
    const next = withRequirement(REQUIRED_EMPLOYEE_DOCUMENT_TYPES, "personal_photo", false);
    expect(next).not.toContain("personal_photo");
    expect(next).toHaveLength(REQUIRED_EMPLOYEE_DOCUMENT_TYPES.length - 1);
  });

  it("returns null once the list is back to the company default", () => {
    const custom = withRequirement(REQUIRED_EMPLOYEE_DOCUMENT_TYPES, "driving_license", true)!;
    expect(withRequirement(custom, "driving_license", false)).toBeNull();
  });

  it("keeps the canonical order regardless of the order things were toggled in", () => {
    const a = withRequirement(withRequirement([], "cv", true)!, "national_id_photo", true);
    expect(a).toEqual(["national_id_photo", "cv"]);
  });

  it("parses stored JSON defensively", () => {
    expect(parseRequiredDocuments(null)).toBeUndefined();
    expect(parseRequiredDocuments("nope")).toBeUndefined();
    expect(parseRequiredDocuments(["cv", "made_up", "other", "national_id_photo"])).toEqual(["national_id_photo", "cv"]);
  });

  it("never treats 'other' as requirable", () => {
    expect(canBeRequired("other")).toBe(false);
    expect(canBeRequired("cv")).toBe(true);
  });
});
