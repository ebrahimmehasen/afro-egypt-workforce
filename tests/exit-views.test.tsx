import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { MidDayDetails } from "@/components/attendance/mid-day-exits-badge";
import { PermissionDurationPicker } from "@/components/leaves/permission-duration-picker";
import type { ClassifyContext } from "@/components/attendance/classify-exit-dialog";
import { analyzeMidDay } from "@/lib/mid-day-exits";
import { PRESET_DURATIONS } from "@/lib/permission-duration";

/**
 * What the day view and the permission form show: the return set against the permission (with the engine's own late
 * minutes), the classify action only for whoever may approve leaves, the record-only note for everyone, and the quick
 * durations. Rendered as markup, no database.
 */
// The app runs on the React that Next ships, which has the form hooks the dialogs use; the React in node_modules
// (what vitest loads) may not, so they are given inert stand-ins: these tests look at what is rendered, not at submitting.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useActionState: () => [{}, () => {}, false] }));
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), useFormStatus: () => ({ pending: false }) }));
vi.mock("@/lib/actions/leaves", () => ({ classifyExit: async () => ({}) }));
vi.mock("@/lib/actions/exit-annotations", () => ({ annotateExit: async () => ({}) }));

const render = (node: React.ReactNode) => renderToStaticMarkup(<LocaleProvider locale="ar" dictionary={ar}>{node}</LocaleProvider>);
const at = (iso: string) => new Date(iso);
const permission = { id: "P", start: at("2026-11-10T07:00:00.000Z"), durationMinutes: 30 };
const base = { actualIn: at("2026-11-10T05:00:00.000Z"), actualOut: at("2026-11-10T13:30:00.000Z"), dayEnd: at("2026-11-10T13:30:00.000Z"), graceMinutes: 0 };
const punches = (...iso: string[]) => iso.map((t) => ({ at: at(t), source: "biometric" }));

describe("the return comparison on the day view", () => {
  it("shows where the permission ends, when they came back and the minutes late, in Egypt's clock", () => {
    const analysis = analyzeMidDay({
      ...base,
      permissions: [permission],
      punches: punches("2026-11-10T05:00:00.000Z", "2026-11-10T07:00:00.000Z", "2026-11-10T07:50:00.000Z", "2026-11-10T13:30:00.000Z"),
    });
    const html = render(<MidDayDetails analysis={analysis} />);
    // 07:30Z and 07:50Z are 09:30 and 09:50 in Cairo in November, whatever zone this machine is in
    expect(html).toContain("الإذن لحد 09:30");
    expect(html).toContain("رجع 09:50");
    expect(html).toContain("رجع بعد نهاية الإذن بـ 20 دقيقة");
  });

  it("says so when they were back in time", () => {
    const analysis = analyzeMidDay({
      ...base,
      permissions: [permission],
      punches: punches("2026-11-10T05:00:00.000Z", "2026-11-10T07:00:00.000Z", "2026-11-10T07:25:00.000Z", "2026-11-10T13:30:00.000Z"),
    });
    const html = render(<MidDayDetails analysis={analysis} />);
    expect(html).toContain(ar.midDay.returnOnTime);
    expect(html).not.toContain("رجع بعد نهاية الإذن");
  });
});

describe("classifying an exit from the day view", () => {
  const analysis = analyzeMidDay({
    ...base,
    permissions: [],
    punches: punches("2026-11-10T05:00:00.000Z", "2026-11-10T08:00:00.000Z", "2026-11-10T09:00:00.000Z", "2026-11-10T13:30:00.000Z"),
  });
  const outIso = "2026-11-10T08:00:00.000Z";
  const context = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
    employeeId: "E1",
    date: "2026-11-10",
    canClassify: true,
    windows: { [outIso]: { startTime: "10:00", minutes: 60, back: "2026-11-10T09:00:00.000Z" } },
    annotations: {},
    ...over,
  });

  it("offers the classify action to whoever may approve leaves, on a stretch with no permission", () => {
    expect(render(<MidDayDetails analysis={analysis} classify={context()} />)).toContain(ar.midDay.classify);
  });

  it("offers nothing to anyone else, and nothing when no context is given", () => {
    expect(render(<MidDayDetails analysis={analysis} classify={context({ canClassify: false })} />)).not.toContain(ar.midDay.classify);
    expect(render(<MidDayDetails analysis={analysis} />)).not.toContain(ar.midDay.classify);
  });

  it("shows a record-only note to everyone, saying it changes nothing", () => {
    const note = context({ canClassify: false, annotations: { [outIso]: { type: "mission", by: "HR-1", reason: "مأمورية للميناء" } } });
    const html = render(<MidDayDetails analysis={analysis} classify={note} />);
    expect(html).toContain("اتوثّق كـ");
    expect(html).toContain("HR-1");
    expect(html).toContain("ما غيّرش أي خصم أو أجر");
    expect(html).toContain("المعالجة المالية بانتظار القرار");
    expect(html).not.toContain(ar.midDay.classify);
  });
});

describe("the duration choices of a permission", () => {
  it("lists the quick durations first, then a custom duration and an until time", () => {
    const html = render(<PermissionDurationPicker startTime="09:00" />);
    let last = -1;
    for (const m of PRESET_DURATIONS) {
      const at = html.indexOf(`${m} دقيقة`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(html.indexOf(ar.leaves.durationCustom)).toBeGreaterThan(last);
    expect(html.indexOf(ar.leaves.durationUntil)).toBeGreaterThan(html.indexOf(ar.leaves.durationCustom));
  });
});

describe("the mission / excused absence options say they change nothing, in both languages", () => {
  // Until the business decision on how they are paid, choosing one only records a note: the wording must never
  // suggest a charge is waived. (The dialog shows classifyRecordOnlyLabel under each option's name.)
  it("the label under each option, the hint and the note on the stretch all say: record only, no charge or pay changed, pay treatment pending", () => {
    for (const phrase of ["للتوثيق فقط", "لا يغيّر أي خصم أو أجر", "بانتظار القرار"]) expect(ar.midDay.classifyRecordOnlyLabel).toContain(phrase);
    for (const phrase of ["Record only", "does not change any charge or pay", "pending decision"]) expect(en.midDay.classifyRecordOnlyLabel).toContain(phrase);
    expect(ar.midDay.classifyRecordOnlyHint).toContain("مش معنى التسجيل إنها اتعفت");
    expect(en.midDay.classifyRecordOnlyHint).toContain("does not mean it was excused");
    expect(ar.midDay.annotatedAs).toContain("للتوثيق فقط");
    expect(en.midDay.annotatedAs).toContain("record only");
    for (const text of [ar.midDay.classifyRecordOnlyLabel, ar.midDay.annotatedAs, en.midDay.classifyRecordOnlyLabel, en.midDay.annotatedAs]) {
      expect(text).not.toMatch(/معفي|اتعفت من الخصم|excused from|waived/i);
    }
  });
});
