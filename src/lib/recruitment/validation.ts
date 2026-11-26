import { z } from "zod";
import { RECRUITMENT_LIMITS as L } from "@/lib/recruitment/config";
import { CUSTOM_KEY_PATTERN, FIELD_TYPES, RESERVED_KEYS } from "@/lib/recruitment/form-config";

// Validation for what HR edits on the internal screens (the public submission is validated by form-config.ts).

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

export const jobSchema = z
  .object({
    title: z.string().trim().min(2).max(L.maxJobTitle),
    description: optional(z.string().trim().max(L.maxJobDescription)),
    open: z.boolean(),
    salaryMin: optional(z.coerce.number().min(0).max(L.maxExpectedSalary)),
    salaryMax: optional(z.coerce.number().min(0).max(L.maxExpectedSalary)),
    showSalary: z.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .refine((j) => j.salaryMin === undefined || j.salaryMax === undefined || j.salaryMin <= j.salaryMax, { path: ["salaryMax"] });
export type JobInput = z.infer<typeof jobSchema>;

/** One option per line, "Arabic | English" (a line with no bar uses the same text for both). */
export function parseOptionLines(text: string): { value: string; ar: string; en: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((l, i) => {
      const [ar, en] = l.split("|").map((s) => s.trim());
      return { value: `o${i + 1}`, ar: ar.slice(0, 120), en: (en || ar).slice(0, 120) };
    });
}

/** Editing a field of the form: its label in both languages, the two flags, the order, and for a select its options. */
export const formFieldSchema = z.object({
  key: z.string().trim().min(1).max(64),
  labelAr: z.string().trim().min(1).max(190),
  labelEn: z.string().trim().min(1).max(190),
  required: z.boolean(),
  visible: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(100000),
  optionsText: z.string().max(4000).optional(),
});
export type FormFieldInput = z.infer<typeof formFieldSchema>;

export const newQuestionSchema = formFieldSchema.omit({ key: true }).extend({ type: z.enum(FIELD_TYPES as [string, ...string[]]) });

export const isValidCustomKey = (key: string) => CUSTOM_KEY_PATTERN.test(key) && !RESERVED_KEYS.has(key);
