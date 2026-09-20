import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LocaleProvider } from "@/components/providers/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";

// Radix Tabs pins dir="ltr" when no DirectionProvider is mounted, which flipped the
// tab order and left-aligned the whole tab area on the Arabic (rtl) pages.
function render(locale: "ar" | "en", dir?: "ltr" | "rtl") {
  const tabs = createElement(
    Tabs,
    { defaultValue: "a", dir },
    createElement(TabsList, null, createElement(TabsTrigger, { value: "a" }, "A"), createElement(TabsTrigger, { value: "b" }, "B")),
  );
  // LocaleProvider is a plain function component (no hooks), so calling it directly keeps `children` typed.
  return renderToStaticMarkup(LocaleProvider({ locale, dictionary: {} as Dictionary, children: tabs }));
}

describe("Tabs direction follows the locale", () => {
  it("is rtl in Arabic, so the first tab sits on the right", () => {
    expect(render("ar")).toContain('dir="rtl"');
    expect(render("ar")).not.toContain('dir="ltr"');
  });

  it("is ltr in English", () => {
    expect(render("en")).toContain('dir="ltr"');
    expect(render("en")).not.toContain('dir="rtl"');
  });

  it("still honours an explicit dir", () => {
    expect(render("ar", "ltr")).toContain('dir="ltr"');
  });
});
