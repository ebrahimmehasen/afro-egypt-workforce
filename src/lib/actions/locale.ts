"use server";

import { revalidatePath } from "next/cache";
import { Locale, setLocaleCookie } from "@/lib/i18n/locale";

export async function setLocale(locale: Locale) {
  setLocaleCookie(locale);
  revalidatePath("/");
}
