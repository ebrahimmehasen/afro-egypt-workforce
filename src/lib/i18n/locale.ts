import { cookies } from "next/headers";

export type Locale = "ar" | "en";
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "afro_egypt_locale";

export function getLocale(): Locale {
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  return raw === "en" ? "en" : "ar";
}

export function setLocaleCookie(locale: Locale) {
  cookies().set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

export function dir(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
