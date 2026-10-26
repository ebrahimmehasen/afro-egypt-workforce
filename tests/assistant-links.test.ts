import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_LINK_ROOTS, safeInternalHref } from "@/lib/assistant/links";

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

describe("the list of pages", () => {
  it("matches the real top-level pages of the app, so it can't drift", () => {
    const dir = path.join(process.cwd(), "src", "app", "(app)");
    const pages = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect([...ASSISTANT_LINK_ROOTS].sort()).toEqual(pages);
  });
});
