/** Fills {placeholder} tokens in a translated string, e.g. t.employees.totalCount with {count: 5}. Client-safe (no next/headers). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

const MONTHS: Record<"ar" | "en", string[]> = {
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/** Localised month name for a 1-based month number. */
export function monthName(month: number, locale: "ar" | "en"): string {
  return MONTHS[locale][(month - 1 + 12) % 12] ?? "";
}

/** "أغسطس 2026" / "August 2026" */
export function monthYearLabel(year: number, month: number, locale: "ar" | "en"): string {
  return `${monthName(month, locale)} ${year}`;
}
