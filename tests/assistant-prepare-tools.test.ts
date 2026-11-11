import { describe, expect, it } from "vitest";
import type { ToolContext } from "@/lib/assistant/employee-tools";
import { DRAFT_PAGES, readDraft, saveDraft, type FormDraft } from "@/lib/assistant/drafts";
import { safeInternalHref } from "@/lib/assistant/links";
import { runTool } from "@/lib/assistant/tools";
import { ctx as base } from "./helpers/assistant-fixture";

const saved: FormDraft[] = [];
const ctx: ToolContext = { ...base, drafts: { save: (d) => (saved.push(d), `id${saved.length}`) } };
const run = (args: unknown, c: ToolContext = ctx) => runTool("prepare_form", args, c) as Record<string, any>;

const NAME = base.db.employees[0].name;

describe("prepare_form", () => {
  it("fills in a leave request and gives a link, saving nothing in the system", () => {
    const r = run({ form: "leave", employee: NAME, type: "sick", from: "2026-09-21", to: "2026-09-22", reason: "مرض" });
    expect(r).toMatchObject({ ok: true, saved: false, page: "/leaves", link: "/leaves?assistant=id1" });
    expect(r.prepared).toMatchObject({ from: "2026-09-21", to: "2026-09-22", reason: "مرض" });
    expect(saved[0]).toMatchObject({ kind: "leave", values: { type: "sick", from: "2026-09-21", to: "2026-09-22", reason: "مرض" } });
    expect(typeof saved[0].values.employeeId).toBe("string");
  });

  it("uses sensible defaults", () => {
    run({ form: "leave", employee: NAME });
    expect(saved.at(-1)?.values).toMatchObject({ type: "annual", from: "2026-09-20", to: "2026-09-20" });
    run({ form: "overtime", employee: NAME });
    expect(saved.at(-1)?.values).toMatchObject({ date: "2026-09-20", hours: 2 });
  });

  it("never shows the model an internal id", () => {
    expect(JSON.stringify(run({ form: "leave", employee: NAME }))).not.toContain(String(base.db.employees[0].id));
  });

  it("asks for what is missing instead of guessing", () => {
    expect(run({ form: "deduction", employee: NAME })).toMatchObject({ ok: false, missing: ["amount", "reason"] });
    expect(run({ form: "work_request", employees: [NAME] })).toMatchObject({ ok: false, missing: expect.arrayContaining(["date", "details", "from_time", "to_time"]) });
    expect(run({ form: "leave" })).toMatchObject({ ok: false, missing: ["employee"] });
  });

  it("prepares a deduction and a work request", () => {
    expect(run({ form: "deduction", employee: NAME, amount: 100, reason: "تأخير متكرر" })).toMatchObject({ ok: true, page: "/deductions" });
    expect(saved.at(-1)?.values).toMatchObject({ type: "penalty", amount: 100, reason: "تأخير متكرر" });
    const w = run({ form: "work_request", employees: [NAME], date: "2026-09-24", from_time: "18:00", to_time: "22:00", details: "سهر لشحنة" });
    expect(w).toMatchObject({ ok: true, page: "/requests" });
    expect((saved.at(-1)?.values.employeeIds as string[]).length).toBe(1);
  });

  it("refuses bad values", () => {
    expect(run({ form: "leave", employee: NAME, from: "2026-09-22", to: "2026-09-21" }).ok).toBe(false);
    expect(run({ form: "leave", employee: NAME, type: "vacation" }).ok).toBe(false);
    expect(run({ form: "overtime", employee: NAME, hours: 30 }).ok).toBe(false);
    expect(run({ form: "work_request", employees: [NAME], date: "2026-09-24", from_time: "6pm", to_time: "22:00", details: "x" }).ok).toBe(false);
    expect(run({ form: "salary_change" }).ok).toBe(false);
  });

  it("does not guess between people or invent one", () => {
    expect(run({ form: "leave", employee: "مش موجود خالص" })).toMatchObject({ ok: false });
  });

  it("is unavailable when there is nowhere to keep the form", () => {
    expect(run({ form: "leave", employee: NAME }, { ...base })).toMatchObject({ ok: false });
  });
});

describe("kept drafts", () => {
  const draft: FormDraft = { kind: "leave", values: { employeeId: "e1" } };

  it("opens only for the user it was made for, and only for a while", () => {
    const id = saveDraft("admin-1", draft, 1_000);
    expect(readDraft("admin-1", id, 2_000)).toEqual(draft);
    expect(readDraft("admin-2", id, 2_000)).toBeNull();
    expect(readDraft("admin-1", id, 1_000 + 31 * 60_000)).toBeNull();
    expect(readDraft("admin-1", "nope", 2_000)).toBeNull();
  });

  it("keeps only the latest few per user", () => {
    const ids = Array.from({ length: 25 }, () => saveDraft("admin-3", draft, 5_000));
    expect(readDraft("admin-3", ids[0], 5_001)).toBeNull();
    expect(readDraft("admin-3", ids[24], 5_001)).toEqual(draft);
  });

  it("makes ids that can not be guessed", () => {
    const a = saveDraft("admin-4", draft);
    const b = saveDraft("admin-4", draft);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(20);
  });
});

describe("the links it produces", () => {
  it("are accepted as safe in-app links", () => {
    for (const page of Object.values(DRAFT_PAGES)) expect(safeInternalHref(`${page}?assistant=AbC-123_xyz`)).toBe(`${page}?assistant=AbC-123_xyz`);
  });
});
