import type { ZodIssue } from "zod";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { ActionState } from "@/hooks/use-action-feedback";
import { format } from "@/lib/i18n/format";

/**
 * Turns zod issues into an error that says WHICH fields are wrong (and why),
 * plus the field names so the form can highlight them — instead of a bare
 * "invalid data". `remap` renames an issue path to the form field the user
 * actually sees (e.g. the salary rule is reported on `salaryType`, but the
 * input to fix is `basicSalary` or `dailyRate`).
 */
export function invalidFieldsError(
  t: Dictionary,
  issues: ZodIssue[],
  remap: (field: string) => string = (f) => f,
): ActionState {
  const fields = Array.from(new Set(issues.map((i) => remap(String(i.path[0] ?? "")) ).filter(Boolean)));
  if (fields.length === 0) return { error: t.validation.invalidData };
  const problems = fields.map((f) => t.validation.fieldProblems[f] ?? f);
  return { error: format(t.validation.invalidFields, { fields: problems.join("، ") }), fields };
}
