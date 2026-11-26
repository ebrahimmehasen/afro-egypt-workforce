import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { allowedNavPaths, canAccess } from "@/lib/permissions";
import { canUseCaseProof, canUseDepartment, caseProofDepartments } from "@/lib/case-proof/audience";
import { checkCasePhoto } from "@/lib/case-proof/files";
import { requestCaseDraft, requestCaseSetDraft } from "@/lib/case-proof/ai-draft";
import { CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";
import { NAV_ITEMS } from "@/lib/i18n/labels";
import { EmployeeCases } from "@/components/case-proof/employee-cases";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";

/**
 * Case proof ("إثبات الحالة"): who may use it (the admin, and a department supervisor with departments on his account, nobody
 * else, not even a menu entry), the photo checks, the AI draft client's fallbacks, and the strings. Pure, no database.
 */
const user = (over: Partial<User>): User => ({ id: "U", name: "U", email: "u@x", role: "admin", permissions: [], ...over });
const admin = user({ role: "admin" });
const supervisor = user({ role: "supervisor", departmentIds: ["D1"], permissions: ["attendance"] });
const supervisorNoGrants = user({ role: "supervisor", departmentIds: ["D1"], permissions: [] });
const others: [string, User][] = [
  ["a supervisor with no department on his account", user({ role: "supervisor", departmentIds: [], permissions: ["attendance"] })],
  ["a supervisor with no departments field at all", user({ role: "supervisor", permissions: ["attendance"] })],
  ["HR, even with departments and every grant", user({ role: "hr", departmentIds: ["D1"], permissions: ["employees", "attendance", "leaves"] })],
  ["HR with no departments", user({ role: "hr", permissions: ["employees"] })],
  ["a staff account", user({ role: "staff", departmentIds: ["D1"], permissions: ["employees"] })],
  ["a regular employee", user({ role: "employee", departmentIds: ["D1"] })],
];

describe("who may use case proof", () => {
  it("the admin, and a department supervisor with departments listed (with or without page grants)", () => {
    expect(canUseCaseProof(admin)).toBe(true);
    expect(canUseCaseProof(supervisor)).toBe(true);
    expect(canUseCaseProof(supervisorNoGrants)).toBe(true);
  });

  it.each(others)("not %s", (_name, who) => {
    expect(canUseCaseProof(who)).toBe(false);
    expect(caseProofDepartments(who)).toEqual([]);
    expect(canUseDepartment(who, "D1")).toBe(false);
  });

  it("a supervisor reaches only the departments on his account; the admin reaches all; an empty list never means everyone", () => {
    expect(caseProofDepartments(admin)).toBeNull();
    expect(caseProofDepartments(supervisor)).toEqual(["D1"]);
    expect(canUseDepartment(supervisor, "D1")).toBe(true);
    expect(canUseDepartment(supervisor, "D2")).toBe(false);
    expect(canUseDepartment(admin, "D2")).toBe(true);
    expect(canUseDepartment(user({ role: "supervisor", departmentIds: [] }), "D1")).toBe(false);
  });
});

describe("the menu entry and the page rule", () => {
  it("is in the navigation for the admin and a department supervisor only", () => {
    expect(allowedNavPaths(admin)).toContain("/case-proof");
    expect(allowedNavPaths(supervisor)).toContain("/case-proof");
    expect(allowedNavPaths(supervisorNoGrants)).toContain("/case-proof");
    for (const [name, who] of others) expect(allowedNavPaths(who), name).not.toContain("/case-proof");
  });

  it("canAccess follows the same rule, for the page and the case pages under it", () => {
    for (const path of ["/case-proof", "/case-proof/abc"]) {
      expect(canAccess(supervisor, path)).toBe(true);
      expect(canAccess(admin, path)).toBe(true);
      for (const [name, who] of others) expect(canAccess(who, path), `${name} ${path}`).toBe(false);
    }
  });

  it("the entry exists in the navigation list, with an Arabic and an English label", () => {
    expect(NAV_ITEMS.some((i) => i.href === "/case-proof" && i.key === "caseProof")).toBe(true);
    expect(ar.nav.caseProof).toBe("إثبات الحالة");
    expect(en.nav.caseProof).toBe("Case proof");
  });

  const cookie = (who: User) => `${Buffer.from(JSON.stringify(who)).toString("base64url")}.sig`;
  const visit = (who: User | null, pathname = "/case-proof") =>
    middleware(new NextRequest(new URL(`http://localhost${pathname}`), who ? { headers: { cookie: `afro_egypt_session=${cookie(who)}` } } : undefined));

  it("the middleware lets the admin and a supervisor in, sends everyone else to the dashboard, and an anonymous visitor to login", () => {
    expect(visit(supervisor).headers.get("location")).toBeNull();
    expect(visit(admin).headers.get("location")).toBeNull();
    for (const [name, who] of others) expect(new URL(visit(who).headers.get("location") ?? "http://x/none").pathname, name).toBe("/dashboard");
    expect(new URL(visit(null).headers.get("location")!).pathname).toBe("/login");
  });
});

describe("the photo checks", () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

  it("accepts a jpg, a png and a webp by declared type AND first bytes", () => {
    expect(checkCasePhoto("image/jpeg", jpg)).toMatchObject({ ok: true, ext: "jpg" });
    expect(checkCasePhoto("image/png", png)).toMatchObject({ ok: true, ext: "png" });
    expect(checkCasePhoto("image/webp", webp)).toMatchObject({ ok: true, ext: "webp" });
  });

  it("refuses another type, a pdf, a file that only claims to be an image, a RIFF that is not webp, empty, and oversize", () => {
    expect(checkCasePhoto("application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toEqual({ ok: false, error: "type" });
    expect(checkCasePhoto("image/gif", new Uint8Array([0x47, 0x49, 0x46]))).toEqual({ ok: false, error: "type" });
    expect(checkCasePhoto("image/png", new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toEqual({ ok: false, error: "type" });
    expect(checkCasePhoto("image/jpeg", png)).toEqual({ ok: false, error: "type" });
    expect(checkCasePhoto("image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toEqual({ ok: false, error: "type" });
    expect(checkCasePhoto("image/png", new Uint8Array())).toEqual({ ok: false, error: "empty" });
    const big = new Uint8Array(L.maxPhotoBytes + 1);
    big.set(png);
    expect(checkCasePhoto("image/png", big)).toEqual({ ok: false, error: "size" });
  });
});

describe("the AI draft client: a draft, or an honest empty field", () => {
  const image = { mime: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) };
  const context = { department: "Packing", uploader: "Supervisor Sami", locale: "en" as const };
  const env = { ASSISTANT_BRIDGE_SECRET: "s3cret", ASSISTANT_BRIDGE_URL: "http://127.0.0.1:4100" };
  const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it("sends the photo, the three names and the secret to the assistant service's describe call, and returns the draft", async () => {
    let seen: { url: string; headers: Record<string, string>; body: { image: { mediaType: string; data: string }; context: Record<string, string> } } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ ok: true, answer: "  A cracked box on the packing line.  " }));
    }) as unknown as typeof fetch;
    const result = await requestCaseDraft({ image, context, env, fetchImpl });
    expect(result).toEqual({ ok: true, text: "A cracked box on the packing line." });
    expect(seen!.url).toBe("http://127.0.0.1:4100/describe-image");
    expect(seen!.headers["x-bridge-secret"]).toBe("s3cret");
    expect(seen!.body.image).toEqual({ mediaType: "image/png", data: Buffer.from(image.bytes).toString("base64") });
    // the department and the uploader only: no employee name is ever sent
    expect(seen!.body.context).toEqual({ locale: "en", department: "Packing", uploader: "Supervisor Sami" });
    expect(JSON.stringify(seen!.body)).not.toContain("Hossam");
  });

  it("not configured: an empty draft with the reason, and no request is made", async () => {
    let called = false;
    const result = await requestCaseDraft({ image, context, env: {}, fetchImpl: (async () => ((called = true), new Response("{}"))) as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(called).toBe(false);
  });

  it("an older service without the describe call (404), a failing one, an unreachable one: never a made-up description", async () => {
    expect(await requestCaseDraft({ image, context, env, fetchImpl: reply(404, { ok: false, code: "bad_request", message: "Not found." }) })).toEqual({ ok: false, reason: "unavailable" });
    expect(await requestCaseDraft({ image, context, env, fetchImpl: reply(503, { ok: false, code: "auth" }) })).toEqual({ ok: false, reason: "auth" });
    expect(await requestCaseDraft({ image, context, env, fetchImpl: reply(429, { ok: false, code: "rate_limited" }) })).toEqual({ ok: false, reason: "rate_limited" });
    expect(await requestCaseDraft({ image, context, env, fetchImpl: reply(502, "not json") })).toEqual({ ok: false, reason: "unavailable" });
    expect(await requestCaseDraft({ image, context, env, fetchImpl: (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("an empty answer is not a draft", async () => {
    expect(await requestCaseDraft({ image, context, env, fetchImpl: reply(200, { ok: true, answer: "   " }) })).toEqual({ ok: false, reason: "bad_response" });
    expect(await requestCaseDraft({ image, context, env, fetchImpl: reply(200, { ok: true }) })).toEqual({ ok: false, reason: "bad_response" });
  });

  it("a slow service times out", async () => {
    const slow = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    expect(await requestCaseDraft({ image, context, env, fetchImpl: slow, timeoutMs: 20 })).toEqual({ ok: false, reason: "timeout" });
  });

  it("the context handed over is cut and flattened, and the draft is capped", async () => {
    let body: { context: Record<string, string> } | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, answer: "x".repeat(L.maxDraftLength + 500) }));
    }) as unknown as typeof fetch;
    const result = await requestCaseDraft({ image, context: { ...context, department: `A\nB ${"y".repeat(500)}` }, env, fetchImpl });
    expect(body!.context.department.length).toBeLessThanOrEqual(L.maxContextLength);
    expect(body!.context.department).not.toContain("\n");
    expect(result.ok && result.text.length).toBe(L.maxDraftLength);
  });
});

describe("the AI set-draft client: the combined draft for a whole set of photos, or an honest empty field", () => {
  const images = [
    { mime: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { mime: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 4, 5]) },
  ];
  const context = { department: "Packing", uploader: "Supervisor Sami", locale: "en" as const };
  const env = { ASSISTANT_BRIDGE_SECRET: "s3cret", ASSISTANT_BRIDGE_URL: "http://127.0.0.1:4100" };
  const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it("sends every photo of the set, the three names and the secret to the assistant service's describe-images call", async () => {
    let seen: { url: string; headers: Record<string, string>; body: { images: { mediaType: string; data: string }[]; context: Record<string, string> } } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ ok: true, answer: "  Two photos of a cracked box on the packing line.  " }));
    }) as unknown as typeof fetch;
    const result = await requestCaseSetDraft({ images, context, env, fetchImpl });
    expect(result).toEqual({ ok: true, text: "Two photos of a cracked box on the packing line." });
    expect(seen!.url).toBe("http://127.0.0.1:4100/describe-images");
    expect(seen!.headers["x-bridge-secret"]).toBe("s3cret");
    expect(seen!.body.images).toEqual(images.map((i) => ({ mediaType: i.mime, data: Buffer.from(i.bytes).toString("base64") })));
    expect(seen!.body.context).toEqual({ locale: "en", department: "Packing", uploader: "Supervisor Sami" });
    expect(JSON.stringify(seen!.body)).not.toContain("Hossam");
  });

  it("not configured: an empty draft with the reason, and no request is made", async () => {
    let called = false;
    const result = await requestCaseSetDraft({ images, context, env: {}, fetchImpl: (async () => ((called = true), new Response("{}"))) as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(called).toBe(false);
  });

  it("an older service without the call, a failing one, an unreachable one: never a made-up description", async () => {
    expect(await requestCaseSetDraft({ images, context, env, fetchImpl: reply(404, { ok: false, code: "bad_request" }) })).toEqual({ ok: false, reason: "unavailable" });
    expect(await requestCaseSetDraft({ images, context, env, fetchImpl: reply(503, { ok: false, code: "auth" }) })).toEqual({ ok: false, reason: "auth" });
    expect(await requestCaseSetDraft({ images, context, env, fetchImpl: (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("an empty answer is not a draft, and a slow service times out", async () => {
    expect(await requestCaseSetDraft({ images, context, env, fetchImpl: reply(200, { ok: true, answer: "   " }) })).toEqual({ ok: false, reason: "bad_response" });
    const slow = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    expect(await requestCaseSetDraft({ images, context, env, fetchImpl: slow, timeoutMs: 20 })).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("case proof never touches attendance, payroll or any pay table", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };
  const root = process.cwd();
  const sources = [
    ...walk(path.join(root, "src", "lib", "case-proof")),
    path.join(root, "src", "lib", "actions", "case-proof.ts"),
    ...walk(path.join(root, "src", "app", "api", "case-proof")),
    ...walk(path.join(root, "src", "components", "case-proof")),
    ...walk(path.join(root, "src", "app", "(app)", "case-proof")),
  ];

  it("none of its code reads or writes a punch, a day, a payroll, deduction, overtime, leave or allowance table", () => {
    expect(sources.length).toBeGreaterThan(8);
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(text, path.relative(root, file)).not.toMatch(/prisma\.(attendanceLog|dailyAttendance|payroll\w*|deduction\w*|overtime|leave|allowance\w*|payType|holiday)\b/);
      expect(text, path.relative(root, file)).not.toMatch(/tx\.(attendanceLog|dailyAttendance|payroll\w*|deduction\w*|overtime|leave|allowance\w*)\b/);
      expect(text, path.relative(root, file)).not.toMatch(/pay-engine|payroll-engine|attendance-deductions|attendance-effects/);
    }
  });
});

describe("Arabic and English have the same case-proof strings", () => {
  const keysOf = (o: unknown, prefix = ""): string[] => (typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => keysOf(v, `${prefix}${k}.`)) : [prefix]);
  const empties = (o: unknown): string[] => (typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => empties(v).map((p) => `${k}.${p}`)) : o === "" ? [""] : []);

  it("the same keys, none empty, the same placeholders", () => {
    expect(keysOf(ar.caseProof).sort()).toEqual(keysOf(en.caseProof).sort());
    expect(empties(ar.caseProof)).toEqual([]);
    expect(empties(en.caseProof)).toEqual([]);
    expect(keysOf(ar.caseProof).length).toBeGreaterThan(40);
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const walk = (a: unknown, b: unknown) => {
      if (typeof a === "string" && typeof b === "string") expect(placeholders(a)).toEqual(placeholders(b));
      else if (a && typeof a === "object") for (const k of Object.keys(a)) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
    };
    walk(ar.caseProof, en.caseProof);
  });

  it("says it is a draft, that it has no effect on pay, and that it is not a penalty, in both languages", () => {
    expect(en.caseProof.aiDraftBadge).toBe("AI draft — review and edit");
    expect(en.caseProof.noEffect).toMatch(/no effect on attendance, payroll or deductions/);
    expect(en.caseProof.noEffect).toMatch(/not a penalty/);
    expect(ar.caseProof.noEffect).toMatch(/مالوش أي تأثير على الحضور أو المرتبات أو الخصومات/);
    expect(ar.caseProof.aiDraftBadge).toMatch(/مسودة من الذكاء الاصطناعي/);
  });

  it("the audit labels exist in both", () => {
    for (const d of [ar, en]) for (const k of ["createCaseProof", "saveCaseProof", "editCaseProof", "discardCaseProof"] as const) expect(d.auditActions[k].length).toBeGreaterThan(3);
  });
});

describe("the employee profile tab", () => {
  const root = process.cwd();
  const profile = readFileSync(path.join(root, "src", "app", "(app)", "employees", "[id]", "page.tsx"), "utf8");
  const employeePage = readFileSync(path.join(root, "src", "app", "(app)", "case-proof", "employee", "[id]", "page.tsx"), "utf8");

  it("the real profile route is keyed by the employee NUMBER in the URL, and the tab reads by the employee database id", () => {
    expect(profile).toContain("const { id: employeeNumber } = await params;");
    expect(profile).toContain("db.employees.find((e) => e.employeeNumber === employeeNumber)");
    expect(profile).toContain("loadEmployeeCaseProofTab(user, { id: employee.id, departmentId: employee.departmentId })");
  });

  it("both the tab and its content exist only when the loader says to show them, and the page never reads cases itself", () => {
    expect(profile).toContain("const { show: showCaseProof, cases: caseProofs } = await loadEmployeeCaseProofTab");
    expect(profile).toMatch(/\{showCaseProof && <TabsTrigger value="case-proof">/);
    expect(profile).toMatch(/\{showCaseProof && \(\s*<TabsContent value="case-proof">/);
    expect(profile).not.toMatch(/prisma\.caseProof/);
    expect(profile).not.toContain("loadCaseProofs(");
  });

  it("the case-proof area has its own page per employee (for a supervisor who cannot open the profile), 404 for anyone not allowed", () => {
    expect(employeePage).toContain("loadEmployeeCaseProofTab(user, employee)");
    expect(employeePage).toMatch(/if \(!tab\.show\) notFound\(\);/);
    expect(employeePage).toContain('requireAccess("/case-proof")');
  });

  const cases = [
    { id: "c1", createdAt: new Date("2026-11-10T09:00:00Z"), createdByName: "Supervisor Sami", finalText: "The pallet was left in the aisle.", aiGenerated: true, employees: [{ id: "e1", name: "Hossam" }, { id: "e2", name: "Mona" }] },
    { id: "c2", createdAt: new Date("2026-11-11T09:00:00Z"), createdByName: "Supervisor Sami", finalText: "A label was upside down.", aiGenerated: false, employees: [{ id: "e1", name: "Hossam" }] },
  ];
  const render = (list: typeof cases, locale: "ar" | "en") =>
    renderToStaticMarkup(createElement(EmployeeCases, { cases: list, t: locale === "ar" ? ar : en, locale }));

  it("shows each saved case with its photo link, its text and (for a group) the other employees, in both languages", () => {
    for (const locale of ["ar", "en"] as const) {
      const html = render(cases, locale);
      expect(html).toContain('data-testid="employee-cases"');
      expect(html).toContain("The pallet was left in the aisle.");
      expect(html).toContain("A label was upside down.");
      expect(html).toContain("/api/case-proof/c1/photo");
      expect(html).toContain("/case-proof/c1");
      // only the group case lists its members
      expect(html.match(/data-testid="group-members"/g)).toHaveLength(1);
      expect(html).toContain("Mona");
      expect(html).toContain((locale === "ar" ? ar : en).caseProof.noEffect);
    }
  });

  it("an employee with no cases shows the empty message, and never any case text", () => {
    const html = render([], "en");
    expect(html).toContain(en.caseProof.profileEmpty);
    expect(html).not.toContain("<img");
  });
});

describe("the migrations only add", () => {
  // the statements only: comments out, and the foreign keys' own "ON DELETE ... ON UPDATE ..." clauses out
  const sql = (name: string) =>
    readFileSync(path.join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL|NO ACTION)/gi, "");

  it("the group migration adds one table with its foreign keys, and copies existing cases into it without dropping or changing anything", () => {
    const text = sql("20261127120000_case_proof_employees");
    expect(text).toContain("CREATE TABLE `CaseProofEmployee`");
    expect(text).toMatch(/INSERT IGNORE INTO `CaseProofEmployee`[\s\S]*FROM `CaseProof`/);
    expect(text).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bMODIFY\b|\bRENAME\b/i);
    // the only ALTERs are the new table's own foreign keys
    const alters = text.match(/ALTER TABLE `[A-Za-z]+`/g) ?? [];
    expect(alters.every((a) => a === "ALTER TABLE `CaseProofEmployee`")).toBe(true);
  });

  it("the case migration before it only creates the new table, and neither touches an existing table", () => {
    const text = sql("20261127110000_case_proof");
    expect(text).toContain("CREATE TABLE `CaseProof`");
    expect(text).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bMODIFY\b/i);
    expect((text.match(/ALTER TABLE `[A-Za-z]+`/g) ?? []).every((a) => a === "ALTER TABLE `CaseProof`")).toBe(true);
  });

  it("the old CaseProof columns are still in the schema, so existing rows stay valid", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const model = schema.slice(schema.indexOf("model CaseProof {"), schema.indexOf("model CaseProofEmployee"));
    expect(model).toMatch(/employeeId\s+String\b/);
    expect(model).toMatch(/departmentId\s+String\b/);
    expect(model).toMatch(/links\s+CaseProofEmployee\[\]/);
  });
});
