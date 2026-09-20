import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "@/lib/assistant/markdown";
import { takeSlot } from "@/lib/assistant/rate-limit";

describe("parseBlocks", () => {
  it("reads headings, paragraphs and both kinds of list", () => {
    const blocks = parseBlocks("### الخلاصة\nفيه مشكلة\nفي الملفات\n\n- أول\n- تاني\n\n1. ابدأ بكذا\n2) ثم كذا");
    expect(blocks).toEqual([
      { type: "heading", level: 3, text: "الخلاصة" },
      { type: "paragraph", text: "فيه مشكلة في الملفات" },
      { type: "ul", items: ["أول", "تاني"] },
      { type: "ol", items: ["ابدأ بكذا", "ثم كذا"] },
    ]);
  });

  it("reads a pipe table and drops the separator row", () => {
    const blocks = parseBlocks("| القسم | العدد |\n|---|---|\n| الأمن | 3 |\n| الإنتاج | 2 |");
    expect(blocks).toEqual([{ type: "table", header: ["القسم", "العدد"], rows: [["الأمن", "3"], ["الإنتاج", "2"]] }]);
  });

  it("accepts other bullet characters and tolerates Windows line endings", () => {
    expect(parseBlocks("• أ\r\n* ب")).toEqual([{ type: "ul", items: ["أ", "ب"] }]);
  });

  it("keeps a paragraph together until the next block starts", () => {
    expect(parseBlocks("سطر أول\nسطر تاني\n- بند")).toEqual([
      { type: "paragraph", text: "سطر أول سطر تاني" },
      { type: "ul", items: ["بند"] },
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseBlocks("  \n\n")).toEqual([]);
  });

  it("never turns text into HTML — angle brackets stay as text", () => {
    expect(parseBlocks("<script>alert(1)</script>")).toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });
});

describe("parseInline", () => {
  it("splits bold and code out of plain text", () => {
    expect(parseInline("عندك **3 موظفين** ناقصين `PROD-001` بس")).toEqual([
      { type: "text", text: "عندك " },
      { type: "bold", text: "3 موظفين" },
      { type: "text", text: " ناقصين " },
      { type: "code", text: "PROD-001" },
      { type: "text", text: " بس" },
    ]);
  });

  it("leaves unmatched markers alone", () => {
    expect(parseInline("2 ** 3")).toEqual([{ type: "text", text: "2 ** 3" }]);
  });
});

describe("takeSlot", () => {
  it("allows up to the limit inside the window, then refuses", () => {
    const hits = new Map<string, number[]>();
    expect([1, 2, 3].map((n) => takeSlot(hits, "u", n, 3, 1000))).toEqual([true, true, true]);
    expect(takeSlot(hits, "u", 4, 3, 1000)).toBe(false);
  });

  it("frees slots as the window slides, and counts each key separately", () => {
    const hits = new Map<string, number[]>();
    for (let n = 0; n < 3; n++) takeSlot(hits, "u", n, 3, 1000);
    expect(takeSlot(hits, "u", 1001, 3, 1000)).toBe(true); // the first call has aged out
    expect(takeSlot(hits, "other", 5, 3, 1000)).toBe(true);
  });

  it("does not count refused calls against the user", () => {
    const hits = new Map<string, number[]>();
    for (let n = 0; n < 3; n++) takeSlot(hits, "u", n, 3, 1000);
    for (let n = 3; n < 50; n++) takeSlot(hits, "u", n, 3, 1000); // ignored while over the limit
    expect(takeSlot(hits, "u", 1002, 3, 1000)).toBe(true);
  });
});
