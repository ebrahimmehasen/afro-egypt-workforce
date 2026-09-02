"use client";

import { createContext, useContext } from "react";
import { Dictionary } from "@/lib/i18n/dictionary";
import { Locale } from "@/lib/i18n/locale";

interface LocaleContextValue {
  locale: Locale;
  t: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={{ locale, t: dictionary }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx.locale;
}

export function useT() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used within a LocaleProvider");
  return ctx.t;
}
