/** Fills {placeholder} tokens in a translated string, e.g. t.employees.totalCount with {count: 5}. Client-safe (no next/headers). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}
