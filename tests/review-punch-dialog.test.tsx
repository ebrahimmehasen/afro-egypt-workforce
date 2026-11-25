import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { ReviewPunchDialog } from "@/components/attendance/review-punch-dialog";

/**
 * The form for entering reviewed punches: explicit that it is for times HR actually knows, and nothing in it that skips,
 * estimates or waives a charge. Rendered as markup, no database.
 */
vi.mock("@/lib/actions/review-punches", () => ({ addReviewedPunches: async () => ({}) }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: (action: unknown, initial: unknown) => [initial, action] };
});
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormStatus: () => ({ pending: false }) };
});
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  return { Dialog: Pass, DialogTrigger: Pass, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogFooter: Pass };
});

const dictionaries = { ar, en } as const;
const escaped = (s: string) => s.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const render = (locale: "ar" | "en") =>
  renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaries[locale]}>
      <ReviewPunchDialog employeeId="E1" date="2026-11-16" employeeName="Hossam" />
    </LocaleProvider>,
  );

describe("the reviewed-punches form", () => {
  it("says it is for times HR actually knows, in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = render(locale);
      expect(html).toContain('data-testid="review-punch-intro"');
      expect(html).toContain(escaped(dictionaries[locale].reviewPunch.intro));
    }
    expect(ar.reviewPunch.intro).toContain("أوقات الخروج أو الرجوع اللي HR عارفها فعلاً");
    expect(en.reviewPunch.intro).toMatch(/actually knows/);
  });

  it("has an exit time, a return time and a required source, and posts the employee and the day", () => {
    const html = render("ar");
    expect(html).toContain('name="outTime"');
    expect(html).toContain('name="backTime"');
    expect(html).toMatch(/<textarea[^>]*name="reason"[^>]*required/);
    expect(html).toContain('name="employeeId" value="E1"');
    expect(html).toContain('name="date" value="2026-11-16"');
  });

  it("has no skip, estimate or no-charge control: one opening button and one save button, nothing else", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = render(locale);
      expect(html.match(/<button/g)).toHaveLength(2);
      // the only places those words appear are the sentence saying there are none
      const withoutIntro = html.replace(escaped(dictionaries[locale].reviewPunch.intro), "");
      expect(withoutIntro).not.toMatch(/skip|estimate|waive|no charge|تخطي|تخطّي|تقدير|بدون خصم/i);
    }
  });

  it("the explanation names no number or multiplier (they live in Settings)", () => {
    for (const text of [ar.reviewPunch.intro, en.reviewPunch.intro]) {
      expect(text).not.toMatch(/[0-9٠-٩]/);
      expect(text).not.toMatch(/multiplier|مضاعف/i);
    }
  });
});
