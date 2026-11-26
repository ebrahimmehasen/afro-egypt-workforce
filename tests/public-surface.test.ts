import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { isPublicPath } from "@/lib/public-paths";
import { canAccess, canManageApplications } from "@/lib/permissions";
import type { User } from "@/lib/types";

/**
 * Only /apply (and /login) are open to a visitor without an account, and the one public endpoint is POST /api/apply. Every
 * other page redirects to /login (checked on every page.tsx in the app, discovered from the file system, so a page added
 * later is covered), and every other API route carries its own session check. Nothing public reads the HR system.
 */
const APP_DIR = path.join(process.cwd(), "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(APP_DIR);

/** /employees/applications/[id]/page.tsx -> /employees/applications/x ; route groups like (app) vanish. */
const routeOf = (file: string) =>
  "/" +
  path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => (s.startsWith("[") ? "x" : s))
    .join("/");

const pages = files.filter((f) => path.basename(f) === "page.tsx").map(routeOf);
const apiRoutes = files.filter((f) => path.basename(f) === "route.ts");

const visit = (pathname: string, cookie?: string) =>
  middleware(new NextRequest(new URL(`http://localhost${pathname}`), cookie ? { headers: { cookie: `afro_egypt_session=${cookie}` } } : undefined));

describe("pages without a login", () => {
  it("finds the pages (so the checks below are not vacuous)", () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(pages).toContain("/apply");
    expect(pages).toContain("/employees/applications");
    expect(pages).toContain("/employees/applications/form");
    expect(pages).toContain("/employees/jobs");
  });

  it("exactly /apply and /login are public", () => {
    expect(pages.filter(isPublicPath).sort()).toEqual(["/apply", "/login"]);
  });

  it("every other page redirects an anonymous visitor to /login", () => {
    for (const route of pages.filter((p) => !isPublicPath(p))) {
      const res = visit(route);
      expect(res.status, route).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname, route).toBe("/login");
    }
  });

  it("the public pages are reachable without a session", () => {
    for (const route of ["/apply", "/apply/", "/login"]) {
      const res = visit(route);
      expect(res.headers.get("location"), route).toBeNull();
    }
  });

  it("lookalike paths are not public", () => {
    for (const route of ["/applications", "/apply-admin", "/employees/apply", "/applyx", "/employees/applications"]) {
      expect(isPublicPath(route), route).toBe(false);
      expect(visit(route).headers.get("location"), route).toContain("/login");
    }
  });
});

describe("API routes", () => {
  const rel = (f: string) => path.relative(APP_DIR, f).split(path.sep).join("/");
  const AUTH = /getSession|requireSession|requireAccess/;
  // POST /api/apply is the one public endpoint. These two are not for browsers and answer 401 without their own token
  // (the fingerprint device's secret, the assistant's short-lived signed token).
  const PUBLIC_ENDPOINT = "api/apply/route.ts";
  const TOKEN_ONLY = new Set(["api/punch/route.ts", "api/assistant/tool/route.ts"]);
  const OPEN = new Set([PUBLIC_ENDPOINT, ...TOKEN_ONLY]);

  it("every route other than the allow-list checks a session itself", () => {
    expect(apiRoutes.length).toBeGreaterThan(8);
    for (const file of apiRoutes) {
      if (OPEN.has(rel(file))) continue;
      expect(AUTH.test(readFileSync(file, "utf8")), rel(file)).toBe(true);
    }
  });

  it("the applications download is one of them, and is limited to admin and HR", () => {
    const source = readFileSync(path.join(APP_DIR, "api", "applications", "[id]", "documents", "[docId]", "route.ts"), "utf8");
    expect(source).toContain("canManageApplications");
    expect(source).toMatch(/status: 401/);
    expect(source).toMatch(/status: 403/);
  });

  it("the routes that skip the session check are exactly these three, and the token-only ones still demand their token", () => {
    expect([...OPEN].sort()).toEqual(["api/apply/route.ts", "api/assistant/tool/route.ts", "api/punch/route.ts"]);
    for (const key of TOKEN_ONLY) {
      const source = readFileSync(path.join(APP_DIR, key), "utf8");
      // the punch route answers 401 itself; the assistant tool route hands the Authorization header to its token check
      expect(source.includes("401") || source.includes('get("authorization")'), key).toBe(true);
    }
  });
});

describe("nothing public reads the HR system", () => {
  const publicSources = [
    ...walk(path.join(APP_DIR, "apply")),
    path.join(APP_DIR, "api", "apply", "route.ts"),
    ...walk(path.join(process.cwd(), "src", "lib", "recruitment")).filter((f) => !f.endsWith("actions.ts")),
    path.join(process.cwd(), "src", "components", "recruitment", "apply-form.tsx"),
  ];
  const text = publicSources.map((f) => [path.relative(process.cwd(), f), readFileSync(f, "utf8")] as const);

  it("none of the public code touches employees, payroll, attendance, users or the session", () => {
    expect(text.length).toBeGreaterThan(8);
    for (const [name, source] of text) {
      expect(source, name).not.toMatch(/prisma\.(employee|user|payroll\w*|dailyAttendance|attendanceLog|leave|deduction\w*|overtime|department|auditLogEntry)\b/);
      expect(source, name).not.toMatch(/getSession|requireAccess|requireSession|@\/lib\/data"|getDb/);
    }
  });

  it("the public loaders only read job openings and form fields", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "lib", "recruitment", "data.ts"), "utf8");
    expect([...source.matchAll(/prisma\.(\w+)\./g)].map((m) => m[1]).sort()).toEqual(["formField", "jobOpening"]);
  });
});

describe("who reaches the internal pages", () => {
  const user = (over: Partial<User>): User => ({ id: "U", name: "U", email: "u@x", role: "admin", permissions: [], ...over });

  it("only the admin and HR holding the employees grant manage applications; no new permission was added", () => {
    expect(canManageApplications(user({ role: "admin" }))).toBe(true);
    expect(canManageApplications(user({ role: "hr", permissions: ["employees"] }))).toBe(true);
    for (const who of [
      user({ role: "hr", permissions: [] }),
      user({ role: "hr", permissions: ["leaves", "attendance"] }),
      user({ role: "supervisor", permissions: ["employees"] }),
      user({ role: "staff", permissions: ["employees"] }),
      user({ role: "employee" }),
    ]) {
      expect(canManageApplications(who), `${who.role} ${who.permissions}`).toBe(false);
    }
  });

  it("the internal routes sit under /employees, so a logged-in user without that page never gets there", () => {
    for (const route of ["/employees/applications", "/employees/applications/x", "/employees/applications/form", "/employees/jobs"]) {
      expect(canAccess(user({ role: "employee" }), route), route).toBe(false);
      expect(canAccess(user({ role: "hr", permissions: ["leaves"] }), route), route).toBe(false);
      expect(canAccess(user({ role: "hr", permissions: ["employees"] }), route), route).toBe(true);
    }
  });
});
