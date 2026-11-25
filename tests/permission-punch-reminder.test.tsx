import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { PunchReminder } from "@/components/leaves/punch-reminder";
import { ClassifyExitDialog } from "@/components/attendance/classify-exit-dialog";

/**
 * The reminder that a permission is counted from the actual out and in punches: its wording in both languages, the
 * required (UI-only) confirmation, and where it is shown. Rendered as markup, no database.
 */
vi.mock("@/lib/actions/leaves", () => ({ classifyExit: async () => ({}), createLeave: async () => ({}) }));
vi.mock("@/lib/actions/exit-annotations", () => ({ annotateExit: async () => ({}) }));
// the installed React may predate useActionState: a stand-in that returns the initial state
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: (action: unknown, initial: unknown) => [initial, action] };
});
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormStatus: () => ({ pending: false }) };
});
// a closed Radix dialog renders nothing in static markup: show its content inline
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  return { Dialog: Pass, DialogTrigger: Pass, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogFooter: Pass };
});

const dictionaries = { ar, en } as const;
const render = (locale: "ar" | "en", node: React.ReactNode) =>
  renderToStaticMarkup(<LocaleProvider locale={locale} dictionary={dictionaries[locale]}>{node}</LocaleProvider>);

describe("the wording", () => {
  it("is in Arabic and English, names both punches, and says time past the permission follows the settings", () => {
    expect(ar.leaves.punchReminder).toBe(
      "نبّه الموظف إنه لازم يبصم عند الخروج وعند الرجوع. الإذن بيتحسب من بصمة الخروج والرجوع الفعلية، والزيادة عن مدة الإذن بتتحسب حسب إعدادات الحساب.",
    );
    expect(en.leaves.punchReminder).toMatch(/leaving/);
    expect(en.leaves.punchReminder).toMatch(/coming back/);
    expect(en.leaves.punchReminder).toMatch(/settings/);
  });

  it("carries no numbers or multipliers (they live in Settings)", () => {
    for (const text of [ar.leaves.punchReminder, en.leaves.punchReminder]) {
      expect(text).not.toMatch(/[0-9٠-٩]/);
      expect(text).not.toMatch(/multiplier|مضاعف|×/i);
    }
  });
});

describe("the reminder", () => {
  it("is a visible note in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = render(locale, <PunchReminder />);
      expect(html).toContain('data-testid="punch-reminder"');
      expect(html).toContain('role="note"');
      expect(html).toContain(dictionaries[locale].leaves.punchReminder);
    }
  });

  it("is informational only: no checkbox, no input, nothing that gates a form", () => {
    for (const locale of ["ar", "en"] as const) expect(render(locale, <PunchReminder />)).not.toMatch(/<input|checkbox|required|<button/);
    expect(Object.keys(ar.leaves)).not.toContain("punchConfirm");
    expect(Object.keys(en.leaves)).not.toContain("punchConfirm");
  });
});

describe("where it is shown", () => {
  it("the classify-exit dialog shows the reminder (and still no checkbox)", () => {
    const html = render(
      "ar",
      <ClassifyExitDialog employeeId="E1" date="2026-11-25" startTime="10:00" minutes={30} out="10:00" back="10:30" outIso="2026-11-25T08:00:00.000Z" backIso="2026-11-25T08:30:00.000Z" />,
    );
    expect(html).toContain(ar.leaves.punchReminder);
    expect(html).not.toContain('type="checkbox"');
    // the existing intro is still there, unchanged
    expect(html).toContain("ده بيسجّل إذن معتمد للفترة");
  });

  it("the leave form shows it, informational only, in its permission branch and nowhere else", () => {
    const src = readFileSync("src/components/leaves/leave-form-dialog.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(src.match(/<PunchReminder \/>/g)).toHaveLength(1);
    expect(src).not.toMatch(/type="checkbox"|punchConfirm/); // the form saves exactly as before
    const permissionBranch = src.slice(src.indexOf("{isPermission ? ("), src.indexOf(") : (\n            <div className=\"grid grid-cols-2"));
    expect(permissionBranch).toContain("<PunchReminder />");
    expect(permissionBranch).toContain("PermissionDurationPicker");
    expect(src.replace(permissionBranch, "")).not.toContain("<PunchReminder");
  });
});
