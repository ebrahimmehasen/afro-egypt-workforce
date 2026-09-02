import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { Dictionary } from "@/lib/i18n/dictionary";
import { Locale, getLocale } from "@/lib/i18n/locale";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Server-only convenience: reads the locale cookie and returns its dictionary in one call. */
export function getT(): Dictionary {
  return getDictionary(getLocale());
}

export { format } from "@/lib/i18n/format";
export * from "@/lib/i18n/locale";
export * from "@/lib/i18n/dictionary";
