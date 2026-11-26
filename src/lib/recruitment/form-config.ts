import { RECRUITMENT_LIMITS as L } from "@/lib/recruitment/config";

// The public application form is configured from the internal screen (FormField rows). This file is the one place that knows
// the default fields, how rows override them, and how a submission is validated AGAINST THAT SAME CONFIG: the server never
// trusts the browser about which fields exist, are required, or what a select may hold. Pure and client-safe: the form
// renders from `resolveFormConfig`, the route validates with `validateSubmission`, and the tests call both without a database.

export type FieldType = "text" | "longtext" | "number" | "select" | "date" | "file";
export const FIELD_TYPES: FieldType[] = ["text", "longtext", "number", "select", "date", "file"];

export interface FieldOption {
  value: string;
  ar: string;
  en: string;
}

export interface FieldDef {
  key: string;
  labelAr: string;
  labelEn: string;
  type: FieldType;
  options: FieldOption[];
  required: boolean;
  visible: boolean;
  sortOrder: number;
  /** Core field: always shown and required, never removed or hidden whatever a row says. */
  builtin: boolean;
  /** A question HR added (stored in the answers snapshot) rather than one of the default fields (stored in its own column). */
  custom: boolean;
}

/** What a FormField row holds (the database model, without its bookkeeping columns). */
export interface FormFieldRow {
  key: string;
  labelAr: string;
  labelEn: string;
  type: FieldType;
  options: unknown;
  required: boolean;
  visible: boolean;
  sortOrder: number;
  builtin: boolean;
}

/** The three core fields: which job, who, and how to reach them. */
export const CORE_FIELD_KEYS = ["job", "fullName", "phone"] as const;
/** The form key of the job picker. It is stored as the application's jobOpeningId. */
export const JOB_FIELD_KEY = "job";
/** The file field a certificate upload belongs to by default. */
export const CERTIFICATES_KEY = "certificates";

const d = (key: string, labelAr: string, labelEn: string, type: FieldType, sortOrder: number, over: Partial<FieldDef> = {}): FieldDef => ({
  key, labelAr, labelEn, type, options: [], required: false, visible: true, sortOrder, builtin: false, custom: false, ...over,
});

/** The proposed default field set. A default is never deleted (only hidden), and its type never changes. */
export const DEFAULT_FIELDS: FieldDef[] = [
  d("job", "الوظيفة المتقدَّم لها", "Job applied for", "select", 10, { required: true, builtin: true }),
  d("fullName", "الاسم بالكامل", "Full name", "text", 20, { required: true, builtin: true }),
  d("phone", "رقم الموبايل", "Mobile number", "text", 30, { required: true, builtin: true }),
  d("email", "البريد الإلكتروني", "Email", "text", 40),
  d("nationalId", "الرقم القومي", "National ID", "text", 50),
  d("birthDate", "تاريخ الميلاد", "Date of birth", "date", 60),
  d("city", "العنوان / المدينة", "Address / city", "text", 70),
  d("education", "المؤهل الدراسي", "Education", "text", 80, { required: true }),
  d("experience", "الخبرات السابقة", "Previous experience", "longtext", 90),
  d("expectedSalary", "الراتب المتوقع", "Expected salary", "number", 100),
  d(CERTIFICATES_KEY, "الشهادات (PDF أو صور)", "Certificates (PDF or images)", "file", 110),
];
export const DEFAULT_KEYS = new Set(DEFAULT_FIELDS.map((f) => f.key));
/** Keys a custom question may never take: the defaults, plus names the form itself uses. */
export const RESERVED_KEYS = new Set([...DEFAULT_KEYS, "jobOpeningId", "website", "files"]);
export const CUSTOM_KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

export function parseOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    const r = o as Partial<FieldOption> | null;
    return r && typeof r.value === "string" && r.value && typeof r.ar === "string" && typeof r.en === "string" ? [{ value: r.value, ar: r.ar, en: r.en }] : [];
  });
}

/**
 * The form as it is right now: every default field (its row overriding it, if HR changed it) plus the custom questions, in
 * order. The core fields are forced shown and required here, so even a hand-edited row cannot hide or loosen them.
 */
export function resolveFormConfig(rows: FormFieldRow[]): FieldDef[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const fields: FieldDef[] = DEFAULT_FIELDS.map((def) => {
    const row = byKey.get(def.key);
    if (!row) return def;
    const core = def.builtin;
    return {
      ...def,
      labelAr: row.labelAr.trim() || def.labelAr,
      labelEn: row.labelEn.trim() || def.labelEn,
      required: core ? true : row.required,
      visible: core ? true : row.visible,
      sortOrder: row.sortOrder,
    };
  });
  for (const row of rows) {
    if (DEFAULT_KEYS.has(row.key) || !CUSTOM_KEY_PATTERN.test(row.key) || RESERVED_KEYS.has(row.key) || !FIELD_TYPES.includes(row.type)) continue;
    fields.push({
      key: row.key,
      labelAr: row.labelAr,
      labelEn: row.labelEn,
      type: row.type,
      options: row.type === "select" ? parseOptions(row.options) : [],
      required: row.required,
      visible: row.visible,
      sortOrder: row.sortOrder,
      builtin: false,
      custom: true,
    });
  }
  return fields.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

export const visibleFields = (config: FieldDef[]) => config.filter((f) => f.visible);

// ---- validating a submission against the config

export type FieldError = "required" | "invalid" | "hiddenField" | "unknownField" | "tooManyFiles";

export interface ValidatedSubmission {
  jobOpeningId: string;
  fullName: string;
  phone: string;
  email?: string;
  nationalId?: string;
  birthDate?: Date;
  city?: string;
  education?: string;
  experience?: string;
  expectedSalary?: number;
  /** Answers to the custom questions, with the labels as they were when asked. */
  answers: { key: string; labelAr: string; labelEn: string; value: string | number }[];
}

export type SubmissionResult = { ok: true; value: ValidatedSubmission } | { ok: false; errors: Record<string, FieldError> };

const validIsoDate = (v: string) => {
  const date = new Date(`${v}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(v) ? date : null;
};

/** One value against its field. Returns the cleaned value, or an error. The default fields keep the rules they always had. */
function checkValue(field: FieldDef, raw: string): { value: string | number | Date } | FieldError {
  switch (field.key) {
    case "fullName":
      return raw.length >= 2 && raw.length <= L.maxName ? { value: raw } : "invalid";
    case "phone":
      return raw.length <= L.maxPhone && /^[+\d][\d\s()-]*$/.test(raw) && raw.replace(/\D/g, "").length >= L.minPhoneDigits ? { value: raw } : "invalid";
    case "email":
      return raw.length <= L.maxEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? { value: raw } : "invalid";
    case "nationalId":
      return new RegExp(`^\\d{${L.nationalIdLength}}$`).test(raw) ? { value: raw } : "invalid";
    case "birthDate": {
      const date = validIsoDate(raw);
      return date && date.getTime() < Date.now() && date.getUTCFullYear() >= 1900 ? { value: date } : "invalid";
    }
    case "city":
      return raw.length <= L.maxCity ? { value: raw } : "invalid";
    case "education":
      return raw.length >= 2 && raw.length <= L.maxEducation ? { value: raw } : "invalid";
    case "experience":
      return raw.length <= L.maxExperience ? { value: raw } : "invalid";
    case "expectedSalary": {
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= L.maxExpectedSalary ? { value: n } : "invalid";
    }
  }
  switch (field.type) {
    case "text":
      return raw.length <= L.maxEducation ? { value: raw } : "invalid";
    case "longtext":
      return raw.length <= L.maxExperience ? { value: raw } : "invalid";
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= L.maxExpectedSalary ? { value: n } : "invalid";
    }
    case "date": {
      const date = validIsoDate(raw);
      return date && date.getUTCFullYear() >= 1900 ? { value: raw } : "invalid";
    }
    case "select":
      // the job picker's value is checked against the open jobs by the caller; any other select against its own options
      return field.key === JOB_FIELD_KEY ? (raw.length <= 64 ? { value: raw } : "invalid") : field.options.some((o) => o.value === raw) ? { value: raw } : "invalid";
    case "file":
      return "invalid";
  }
}

/**
 * Validates the text fields of a submission against the config. `values` is every form entry (the job included, the honeypot
 * and the files excluded). Any entry that is not a VISIBLE field is rejected: a hidden question cannot be answered by posting
 * it anyway, and an unknown name is never silently kept.
 */
export function validateSubmission(config: FieldDef[], values: Record<string, string>): SubmissionResult {
  const errors: Record<string, FieldError> = {};
  const byKey = new Map(config.map((f) => [f.key, f]));

  for (const key of Object.keys(values)) {
    const field = byKey.get(key);
    if (!field) errors[key] = "unknownField";
    else if (!field.visible) errors[key] = "hiddenField";
    else if (field.type === "file") errors[key] = "invalid";
  }

  const out: Record<string, unknown> & { answers: ValidatedSubmission["answers"] } = { answers: [] };
  for (const field of config) {
    if (field.type === "file" || !field.visible || errors[field.key]) continue;
    const raw = (values[field.key] ?? "").trim();
    if (raw === "") {
      if (field.required) errors[field.key] = "required";
      continue;
    }
    const checked = checkValue(field, raw);
    if (typeof checked === "string") {
      errors[field.key] = checked;
      continue;
    }
    if (field.key === JOB_FIELD_KEY) out.jobOpeningId = raw;
    else if (field.custom) {
      out.answers.push({
        key: field.key,
        labelAr: field.labelAr,
        labelEn: field.labelEn,
        value: field.type === "select" ? field.options.find((o) => o.value === raw)!.ar : (checked.value as string | number),
      });
    } else out[field.key] = checked.value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: out as unknown as ValidatedSubmission };
}

/** The visible file fields a submission may attach to. */
export const fileFields = (config: FieldDef[]) => config.filter((f) => f.type === "file" && f.visible);

/** Checks which files were sent against the config: a file under a hidden or unknown field is refused, a required one must be present. */
export function validateFileFields(config: FieldDef[], countsByKey: Record<string, number>, maxFiles: number = L.maxFiles): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {};
  const allowed = new Map(fileFields(config).map((f) => [f.key, f]));
  let total = 0;
  for (const [key, count] of Object.entries(countsByKey)) {
    if (count === 0) continue;
    total += count;
    if (!allowed.has(key)) errors[key] = config.some((f) => f.key === key && f.type === "file") ? "hiddenField" : "unknownField";
  }
  for (const f of allowed.values()) if (f.required && !(countsByKey[f.key] > 0)) errors[f.key] = "required";
  if (total > maxFiles) errors.files = "tooManyFiles";
  return errors;
}
