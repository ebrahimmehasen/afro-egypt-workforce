import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Employee, Leave, User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { LeavePaper } from "@/components/leaves/leave-paper";
import { LeavesTable } from "@/components/leaves/leaves-table";
import { canViewLeavePaper, leavePaperDays } from "@/lib/leave-paper";
import { viewerScope } from "@/lib/scope";

/**
 * The printable leave paper: what it shows, that a request that is not approved can never pass for one, who may open
 * it, and the print button on every row of the leaves table. Rendered as markup, no database.
 */
vi.mock("@/lib/actions/leaves", () => ({ decideLeave: async () => ({}), deleteLeave: async () => ({}) }));

const dictionaries = { ar, en } as const;
const paper = (locale: "ar" | "en", leave: Leave, days = { calendar: 3, charged: 2 as number | null }) =>
  renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaries[locale]}>
      <LeavePaper t={dictionaries[locale]} leave={leave} employee={{ name: "حسام رجب غريب", employeeNumber: "PROD-011" }} days={days} />
    </LocaleProvider>,
  );

const leave = (over: Partial<Leave> = {}): Leave => ({
  id: "LV-1",
  employeeId: "E1",
  type: "annual",
  from: "2026-12-03",
  to: "2026-12-05",
  reason: "ظروف عائلية",
  status: "pending",
  createdAt: "2026-11-25T22:30:00.000Z", // 00:30 on 26 Nov in Cairo
  ...over,
});

describe("what the paper shows", () => {
  it("has the employee, the leave, the dates, the days, the reason, the request date, the status and both signature lines (Arabic)", () => {
    const html = paper("ar", leave());
    for (const text of [
      "حسام رجب غريب", "PROD-011", ar.leaveTypes.annual, "2026-12-03", "2026-12-05", "ظروف عائلية",
      ar.leavePaper.employeeName, ar.leavePaper.employeeId, ar.leavePaper.leaveType, ar.leavePaper.from, ar.leavePaper.to, ar.leavePaper.days,
      ar.leavePaper.requestDate, ar.leavePaper.reason, ar.leavePaper.status, ar.leavePaper.signatureEmployee, ar.leavePaper.signatureManagement,
    ]) expect(html).toContain(text);
    // the request date is the day in Egypt (late evening UTC is already the next day there)
    expect(html).toContain("2026-11-26");
    expect(html).not.toContain("2026-11-25");
  });

  it("has them in English too", () => {
    const html = paper("en", leave({ type: "sick" }));
    for (const text of [en.leaveTypes.sick, en.leavePaper.employeeName, en.leavePaper.days, en.leavePaper.requestDate, en.leavePaper.signatureEmployee, en.leavePaper.signatureManagement]) {
      expect(html).toContain(text);
    }
  });

  it("shows the days it covers, and the days counted when they differ", () => {
    expect(paper("ar", leave(), { calendar: 3, charged: 2 })).toContain(ar.leavePaper.chargedDays);
    expect(paper("ar", leave(), { calendar: 3, charged: 3 })).not.toContain(ar.leavePaper.chargedDays);
    expect(paper("ar", leave({ type: "mission" }), { calendar: 3, charged: null })).not.toContain(ar.leavePaper.chargedDays);
  });

  it("shows the time of a permission, and a dash when there is no reason", () => {
    const html = paper("ar", leave({ type: "permission", from: "2026-12-03", to: "2026-12-03", startTime: "10:00", durationMinutes: 90, reason: "  " }), { calendar: 1, charged: null });
    expect(html).toContain(ar.leavePaper.time);
    expect(html).toContain("10:00");
    expect(html).toContain("—");
  });

  it("carries no company branding: no image, no logo", () => {
    for (const locale of ["ar", "en"] as const) expect(paper(locale, leave())).not.toMatch(/<img|logo/i);
  });
});

describe("a request that is not approved can't be mistaken for a leave", () => {
  const banner = (html: string) => html.match(/<div data-testid="leave-not-approved"[^>]*>[^<]*<\/div>/)?.[0] ?? "";

  it("pending: قيد المراجعة and a bold غير معتمدة banner that is not hidden when printed", () => {
    const html = paper("ar", leave({ status: "pending" }));
    expect(html).toContain(ar.leavePaper.statusPending);
    expect(ar.leavePaper.statusPending).toBe("قيد المراجعة");
    expect(banner(html)).toContain("غير معتمدة");
    expect(banner(html)).toContain(ar.leavePaper.bannerPending);
    expect(banner(html)).not.toContain("no-print");
    expect(banner(html)).toContain("border-4"); // a border prints where a background colour may not
    // the status box says pending, nothing says approved
    expect(html.match(/<span data-testid="leave-status"[^>]*>([^<]*)<\/span>/)?.[1]).toBe(ar.leavePaper.statusPending);
  });

  it("rejected: مرفوضة and the same banner, saying it was rejected", () => {
    const html = paper("ar", leave({ status: "rejected" }));
    expect(html).toContain(ar.leavePaper.statusRejected);
    expect(banner(html)).toContain("غير معتمدة");
    expect(banner(html)).toContain(ar.leavePaper.bannerRejected);
    expect(banner(html)).not.toContain("no-print");
  });

  it("in English: NOT APPROVED, under review / rejected", () => {
    const pending = paper("en", leave({ status: "pending" }));
    expect(pending).toContain(en.leavePaper.statusPending);
    expect(banner(pending)).toContain("NOT APPROVED");
    const rejected = paper("en", leave({ status: "rejected" }));
    expect(rejected).toContain(en.leavePaper.statusRejected);
    expect(banner(rejected)).toContain("NOT APPROVED");
    expect(banner(rejected)).toContain("rejected");
  });

  it("approved: no banner, the approved status and who approved it", () => {
    const html = paper("ar", leave({ status: "approved", approvedBy: "مدير الموارد" }));
    expect(banner(html)).toBe("");
    expect(html).not.toContain("data-testid=\"leave-not-approved\"");
    expect(html).toContain(ar.leavePaper.statusApproved);
    expect(html).toContain("مدير الموارد");
    expect(html).not.toContain("غير معتمدة");
  });

  it("only the back link and the print button are hidden when printing", () => {
    const html = paper("ar", leave());
    expect(html.match(/no-print/g)?.length).toBeGreaterThanOrEqual(2); // the bar and the button
    // the sheet itself (title, banner, fields, signatures) is outside them
    const bar = html.match(/<div class="[^"]*no-print[^"]*">.*?<\/button><\/div>/)?.[0] ?? "";
    expect(bar).toContain(ar.leavePaper.print);
    expect(bar).not.toContain(ar.leavePaper.title);
  });
});

describe("the days a leave covers", () => {
  const fridayOff = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() === 5 ? ("weekly_off" as const) : ("workday" as const));

  it("counts every calendar day, and for a day of absence the days the balance charges", () => {
    // Thu 26 to Sat 28 Nov 2026: Friday sits between two leave days, so it is charged too: 3 of 3
    expect(leavePaperDays({ type: "annual", from: "2026-11-26", to: "2026-11-28" }, fridayOff)).toEqual({ calendar: 3, charged: 3 });
    // Fri 27 to Sun 29: a weekly day off at the start of the range is not charged: 2 of 3
    expect(leavePaperDays({ type: "annual", from: "2026-11-27", to: "2026-11-29" }, fridayOff)).toEqual({ calendar: 3, charged: 2 });
    // a public holiday is never charged
    const holiday = (day: string) => (day === "2026-11-28" ? ("holiday" as const) : fridayOff(day));
    expect(leavePaperDays({ type: "casual", from: "2026-11-26", to: "2026-11-28" }, holiday)).toEqual({ calendar: 3, charged: 1 });
    expect(leavePaperDays({ type: "casual", from: "2026-11-26", to: "2026-11-26" }, fridayOff)).toEqual({ calendar: 1, charged: 1 });
  });

  it("gives a mission or a permission no charged-day count, and 0 days for an impossible range", () => {
    expect(leavePaperDays({ type: "mission", from: "2026-11-26", to: "2026-11-28" }, fridayOff)).toEqual({ calendar: 3, charged: null });
    expect(leavePaperDays({ type: "permission", from: "2026-11-26", to: "2026-11-26" }, fridayOff).charged).toBeNull();
    expect(leavePaperDays({ type: "annual", from: "2026-11-28", to: "2026-11-26" }, fridayOff).calendar).toBe(0);
  });
});

describe("who may open a leave paper", () => {
  const employees = [{ id: "E1", departmentId: "D1" }, { id: "E2", departmentId: "D2" }] as Pick<Employee, "id" | "departmentId">[];
  const user = (over: Partial<User>): User => ({ id: "U", name: "u", email: "u@x", role: "hr", permissions: [], ...over }) as User;
  const can = (u: User, employeeId: string) => canViewLeavePaper(u, employeeId, viewerScope(u, employees));

  it("the admin: every leave", () => {
    const admin = user({ role: "admin" });
    expect(can(admin, "E1")).toBe(true);
    expect(can(admin, "E2")).toBe(true);
  });

  it("a self-service employee: their own leave only", () => {
    const employee = user({ role: "employee", employeeId: "E1" });
    expect(can(employee, "E1")).toBe(true);
    expect(can(employee, "E2")).toBe(false);
    expect(can(user({ role: "employee" }), "E1")).toBe(false); // an account tied to no employee sees none
  });

  it("HR / a supervisor: only with the leaves page, and only inside their departments", () => {
    expect(can(user({ role: "hr", permissions: ["leaves"] }), "E2")).toBe(true); // company-wide
    expect(can(user({ role: "hr", permissions: ["leaves"], departmentIds: ["D1"] }), "E1")).toBe(true);
    expect(can(user({ role: "hr", permissions: ["leaves"], departmentIds: ["D1"] }), "E2")).toBe(false);
    expect(can(user({ role: "supervisor", permissions: ["leaves"], departmentIds: ["D2"] }), "E2")).toBe(true);
    // a grant on other pages is not the leaves list: no paper
    expect(can(user({ role: "hr", permissions: ["attendance"] }), "E1")).toBe(false);
    expect(can(user({ role: "supervisor", permissions: ["employees"], departmentIds: ["D1"] }), "E1")).toBe(false);
    // no permission at all is self-service: the account's own employee, if it has one
    expect(can(user({ role: "staff", permissions: [] }), "E1")).toBe(false);
  });
});

describe("the print button on the leaves table", () => {
  const rows: Leave[] = [leave({ id: "LV-1" }), leave({ id: "LV-2", status: "approved", type: "casual" }), leave({ id: "LV-3", status: "rejected" })];
  const employees = [{ id: "E1", name: "حسام رجب غريب", employeeNumber: "PROD-011" }] as Employee[];
  const table = (props: { canApprove: boolean; canDelete: boolean }) =>
    renderToStaticMarkup(
      <LocaleProvider locale="ar" dictionary={ar}>
        <LeavesTable leaves={rows} employees={employees} {...props} />
      </LocaleProvider>,
    );

  it("is on every row, whatever its status, for a viewer who can only look", () => {
    const html = table({ canApprove: false, canDelete: false });
    for (const id of ["LV-1", "LV-2", "LV-3"]) expect(html).toContain(`href="/leave-paper/${id}"`);
    expect(html.split(`aria-label="${ar.leaves.printPaper}"`).length - 1).toBe(3);
    expect(html).toContain(ar.leaves.colPaper);
  });

  it("is there for approvers and the admin as well, beside their own actions", () => {
    for (const props of [{ canApprove: true, canDelete: false }, { canApprove: true, canDelete: true }]) {
      const html = table(props);
      for (const id of ["LV-1", "LV-2", "LV-3"]) expect(html).toContain(`href="/leave-paper/${id}"`);
    }
  });
});
