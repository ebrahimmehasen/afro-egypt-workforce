import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDownloadHref, ASSISTANT_LINK_ROOTS, safeInternalHref } from "@/lib/assistant/links";

describe("safeInternalHref", () => {
  it.each(["/dashboard", "/employees", "/employees/PROD-001", "/overtime/statement", "/attendance?date=2026-09-19", "/workforce-cost"])(
    "accepts %s",
    (href) => expect(safeInternalHref(href)).toBe(href),
  );

  it.each([
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "/api/events",
    "/login",
    "/nowhere",
    "/employees/../api",
    "/employees/a b",
    "employees",
    "",
    `/employees/${"a".repeat(300)}`,
  ])("refuses %j", (href) => expect(safeInternalHref(href)).toBeNull());

  it("trims surrounding spaces", () => expect(safeInternalHref("  /payroll ")).toBe("/payroll"));
});

describe("the overtime statement download", () => {
  it.each(["/api/overtime/statement/export", "/api/overtime/statement/export?month=2026-11", "/api/overtime/statement/export?from=2026-11-01&to=2026-11-15"])("is accepted: %s", (href) => {
    expect(isDownloadHref(href)).toBe(true);
    expect(safeInternalHref(href)).toBe(href);
  });

  it.each([
    "/api/payroll/export",
    "/api/overtime/statement/export?month=bad",
    "/api/overtime/statement/export?month=2026-11&month=2026-10&from=2026-11-01&to=2026-11-02",
    "/api/overtime/statement/export?x=1",
    "/api/overtime/statement/export?month=2026-11?x=1",
    "/api/overtime/statement/export/other",
    "/api/overtime/statement",
  ])("is refused: %s", (href) => {
    expect(isDownloadHref(href)).toBe(false);
    expect(safeInternalHref(href)).toBeNull();
  });
});

describe("the list of pages", () => {
  it("matches the real top-level pages of the app, so it can't drift", () => {
    const dir = path.join(process.cwd(), "src", "app", "(app)");
    const pages = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect([...ASSISTANT_LINK_ROOTS].sort()).toEqual(pages);
  });
});
