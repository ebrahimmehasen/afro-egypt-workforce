import { describe, expect, it } from "vitest";
import {
  CORE_FIELD_KEYS,
  DEFAULT_FIELDS,
  resolveFormConfig,
  validateFileFields,
  validateSubmission,
  type FormFieldRow,
} from "@/lib/recruitment/form-config";
import { checkApplicationFile, sanitizeFileName } from "@/lib/recruitment/files";
import { RECRUITMENT_LIMITS as L } from "@/lib/recruitment/config";
import { parseOptionLines } from "@/lib/recruitment/validation";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";

/**
 * The public form is built from HR's configuration, and the server validates a submission against that SAME configuration:
 * a hidden field is rejected, a required one enforced, a select value must be one of its options, the three core fields can
 * never be hidden or made optional. Pure, no database.
 */
const row = (over: Partial<FormFieldRow> & { key: string }): FormFieldRow => ({
  labelAr: "س", labelEn: "Q", type: "text", options: [], required: false, visible: true, sortOrder: 500, builtin: false, ...over,
});
const valid = { job: "J1", fullName: "Hossam Ali", phone: "01012345678", education: "Diploma" };
const check = (rows: FormFieldRow[], values: Record<string, string>) => validateSubmission(resolveFormConfig(rows), values);
const errorsOf = (rows: FormFieldRow[], values: Record<string, string>) => {
  const r = check(rows, values);
  return r.ok ? {} : r.errors;
};

describe("the default form", () => {
  it("is the proposed field set, in order, with the three core fields first, always required", () => {
    const config = resolveFormConfig([]);
    expect(config.map((f) => f.key)).toEqual(["job", "fullName", "phone", "email", "nationalId", "birthDate", "city", "education", "experience", "expectedSalary", "certificates"]);
    for (const key of CORE_FIELD_KEYS) expect(config.find((f) => f.key === key)).toMatchObject({ builtin: true, required: true, visible: true });
    expect(config.filter((f) => f.visible)).toHaveLength(DEFAULT_FIELDS.length);
  });

  it("accepts a complete valid submission and maps the default fields to their own values", () => {
    const r = check([], { ...valid, email: "a@b.com", nationalId: "29801011234567", birthDate: "1998-01-01", city: "Cairo", experience: "3 years", expectedSalary: "6000" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ jobOpeningId: "J1", fullName: "Hossam Ali", phone: "01012345678", email: "a@b.com", nationalId: "29801011234567", city: "Cairo", expectedSalary: 6000 });
      expect(r.value.birthDate?.toISOString().slice(0, 10)).toBe("1998-01-01");
      expect(r.value.answers).toEqual([]);
    }
  });
});

describe("required fields are enforced from the configuration", () => {
  it("the core fields and the default-required education are required", () => {
    expect(errorsOf([], {})).toMatchObject({ job: "required", fullName: "required", phone: "required", education: "required" });
  });

  it("HR can make a default field required, or optional", () => {
    expect(errorsOf([row({ key: "email", required: true })], valid)).toEqual({ email: "required" });
    expect(errorsOf([row({ key: "education", required: false })], { job: "J1", fullName: "Hossam Ali", phone: "01012345678" })).toEqual({});
  });

  it("a required custom question must be answered, an optional one may be left blank", () => {
    const rows = [row({ key: "q_shift", required: true }), row({ key: "q_other", required: false })];
    expect(errorsOf(rows, valid)).toEqual({ q_shift: "required" });
    expect(errorsOf(rows, { ...valid, q_shift: "  " })).toEqual({ q_shift: "required" });
    expect(errorsOf(rows, { ...valid, q_shift: "night" })).toEqual({});
  });

  it("a required file field needs a file, and a file under a field that does not exist is refused", () => {
    const config = resolveFormConfig([row({ key: "certificates", type: "file", required: true })]);
    expect(validateFileFields(config, {})).toEqual({ certificates: "required" });
    expect(validateFileFields(config, { certificates: 1 })).toEqual({});
    expect(validateFileFields(config, { certificates: 1, passport: 1 })).toEqual({ passport: "unknownField" });
  });
});

describe("hidden fields are rejected", () => {
  it("a value posted for a hidden field is an error, not silently kept", () => {
    expect(errorsOf([row({ key: "nationalId", visible: false })], { ...valid, nationalId: "29801011234567" })).toEqual({ nationalId: "hiddenField" });
  });

  it("a hidden required field is not required (it is not asked)", () => {
    expect(errorsOf([row({ key: "education", visible: false, required: true })], { job: "J1", fullName: "Hossam Ali", phone: "01012345678" })).toEqual({});
  });

  it("a hidden custom question can't be answered either, and an unknown name is refused", () => {
    expect(errorsOf([row({ key: "q_x", visible: false })], { ...valid, q_x: "a" })).toEqual({ q_x: "hiddenField" });
    expect(errorsOf([], { ...valid, isAdmin: "true" })).toEqual({ isAdmin: "unknownField" });
  });

  it("a file under a hidden file field is refused", () => {
    const config = resolveFormConfig([row({ key: "certificates", type: "file", visible: false })]);
    expect(validateFileFields(config, { certificates: 1 })).toEqual({ certificates: "hiddenField" });
  });
});

describe("the core fields cannot be hidden, loosened or removed", () => {
  const hostile = CORE_FIELD_KEYS.map((key) => row({ key, visible: false, required: false }));

  it("rows that hide or loosen them change nothing", () => {
    const config = resolveFormConfig(hostile);
    for (const key of CORE_FIELD_KEYS) expect(config.find((f) => f.key === key)).toMatchObject({ visible: true, required: true, builtin: true });
    expect(errorsOf(hostile, {})).toMatchObject({ job: "required", fullName: "required", phone: "required" });
  });

  it("without any row they are still there (they are not stored, so they cannot be deleted)", () => {
    expect(resolveFormConfig([]).filter((f) => f.builtin).map((f) => f.key)).toEqual([...CORE_FIELD_KEYS]);
  });

  it("HR can relabel them", () => {
    const config = resolveFormConfig([row({ key: "fullName", labelAr: "اسمك", labelEn: "Your name", sortOrder: 20 })]);
    expect(config.find((f) => f.key === "fullName")).toMatchObject({ labelAr: "اسمك", labelEn: "Your name" });
  });

  it("a custom row can't take a default's or the form's own name", () => {
    const config = resolveFormConfig([row({ key: "website" }), row({ key: "jobOpeningId" }), row({ key: "files" }), row({ key: "Bad Key" })]);
    expect(config.filter((f) => f.custom)).toEqual([]);
  });
});

describe("a select is checked against its options", () => {
  const select = row({ key: "q_shift", type: "select", options: [{ value: "o1", ar: "صباحي", en: "Morning" }, { value: "o2", ar: "ليلي", en: "Night" }] });

  it("accepts an option and stores the answer with the question's labels", () => {
    const r = check([select], { ...valid, q_shift: "o2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.answers).toEqual([{ key: "q_shift", labelAr: "س", labelEn: "Q", value: "ليلي" }]);
  });

  it("refuses a value that is not one of the options", () => {
    expect(errorsOf([select], { ...valid, q_shift: "o9" })).toEqual({ q_shift: "invalid" });
    expect(errorsOf([select], { ...valid, q_shift: "ليلي" })).toEqual({ q_shift: "invalid" });
  });

  it("option lines: one per line, Arabic | English", () => {
    expect(parseOptionLines("صباحي | Morning\nليلي\n\n")).toEqual([{ value: "o1", ar: "صباحي", en: "Morning" }, { value: "o2", ar: "ليلي", en: "ليلي" }]);
  });
});

describe("the default fields keep their rules, and custom types are checked", () => {
  it("rejects bad values", () => {
    expect(errorsOf([], { ...valid, phone: "abc" })).toEqual({ phone: "invalid" });
    expect(errorsOf([], { ...valid, email: "nope" })).toEqual({ email: "invalid" });
    expect(errorsOf([], { ...valid, nationalId: "123" })).toEqual({ nationalId: "invalid" });
    expect(errorsOf([], { ...valid, birthDate: "2999-01-01" })).toEqual({ birthDate: "invalid" });
    expect(errorsOf([], { ...valid, birthDate: "1998-02-30" })).toEqual({ birthDate: "invalid" });
    expect(errorsOf([], { ...valid, expectedSalary: "-5" })).toEqual({ expectedSalary: "invalid" });
    expect(errorsOf([], { ...valid, fullName: "A" })).toEqual({ fullName: "invalid" });
  });

  it("custom number and date answers", () => {
    const rows = [row({ key: "q_age", type: "number" }), row({ key: "q_when", type: "date" })];
    expect(errorsOf(rows, { ...valid, q_age: "x", q_when: "tomorrow" })).toEqual({ q_age: "invalid", q_when: "invalid" });
    const r = check(rows, { ...valid, q_age: "25", q_when: "2026-12-01" });
    expect(r.ok && r.value.answers.map((a) => a.value)).toEqual([25, "2026-12-01"]);
  });
});

describe("the file rules are unchanged by the configuration", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  it("allows pdf, jpg, png by type and by their first bytes", () => {
    expect(checkApplicationFile("application/pdf", pdf)).toMatchObject({ ok: true, ext: "pdf" });
    expect(checkApplicationFile("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ ok: true, ext: "jpg" });
    expect(checkApplicationFile("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ ok: true, ext: "png" });
  });
  it("refuses another type, a renamed file, an empty one and an oversize one", () => {
    expect(checkApplicationFile("application/x-msdownload", pdf)).toEqual({ ok: false, error: "type" });
    expect(checkApplicationFile("application/pdf", new Uint8Array([0x4d, 0x5a, 0x90]))).toEqual({ ok: false, error: "type" });
    expect(checkApplicationFile("application/pdf", new Uint8Array())).toEqual({ ok: false, error: "empty" });
    const big = new Uint8Array(L.maxFileBytes + 1);
    big.set(pdf);
    expect(checkApplicationFile("application/pdf", big)).toEqual({ ok: false, error: "size" });
  });
  it("too many files is refused", () => {
    const config = resolveFormConfig([]);
    expect(validateFileFields(config, { certificates: L.maxFiles + 1 })).toEqual({ files: "tooManyFiles" });
  });
  it("sanitizes a filename: no path, no markup, bounded", () => {
    expect(sanitizeFileName("..\\..\\evil/<script>.pdf")).toBe("script.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("a".repeat(500)).length).toBe(L.maxFileName);
  });
});

describe("Arabic and English have the same recruitment strings", () => {
  const keysOf = (o: unknown, prefix = ""): string[] =>
    typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => keysOf(v, `${prefix}${k}.`)) : [prefix];
  const empties = (o: unknown): string[] =>
    typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => empties(v).map((p) => `${k}.${p}`)) : o === "" ? [""] : [];

  it("the same keys in both, none empty", () => {
    expect(keysOf(ar.recruitment).sort()).toEqual(keysOf(en.recruitment).sort());
    expect(empties(ar.recruitment)).toEqual([]);
    expect(empties(en.recruitment)).toEqual([]);
    expect(keysOf(ar.recruitment).length).toBeGreaterThan(60);
  });
  it("the placeholders match in both languages", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const walk = (a: unknown, b: unknown) => {
      if (typeof a === "string" && typeof b === "string") expect(placeholders(a)).toEqual(placeholders(b));
      else if (a && typeof a === "object") for (const k of Object.keys(a)) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
    };
    walk(ar.recruitment, en.recruitment);
  });
  it("the audit labels exist in both", () => {
    for (const d of [ar, en]) for (const k of ["createJob", "editJob", "updateApplication", "editFormField", "addFormQuestion", "removeFormQuestion"] as const) expect(d.auditActions[k].length).toBeGreaterThan(3);
  });
});

