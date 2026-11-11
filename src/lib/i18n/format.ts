/** Fills {placeholder} tokens in a translated string, e.g. t.employees.totalCount with {count: 5}. Client-safe (no next/headers). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

/**
 * BCP-47 tag for all `Intl` / `toLocale*` formatting. The Arabic UI keeps
 * Arabic month names and labels but always renders digits in Latin (Western)
 * numerals — the app mixes Arabic and English text, so Arabic-Indic digits
 * (٠١٢٣) next to Latin ones read as inconsistent.
 */
export function intlLocale(locale: "ar" | "en"): string {
  return locale === "ar" ? "ar-EG-u-nu-latn" : "en-US";
}

/**
 * The time zone every time in the app is shown in: Egypt's, whoever is looking and whatever their phone or PC is
 * set to. Without it the browser uses its own device's zone, so one punch read 08:00 on one screen and 09:00 on a
 * device set an hour off (a wrong zone, or one that missed Egypt's summer-time change).
 */
export const APP_TIME_ZONE = "Africa/Cairo";

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
