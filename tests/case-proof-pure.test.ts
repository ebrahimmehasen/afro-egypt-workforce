import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { allowedNavPaths, canAccess } from "@/lib/permissions";
import { canUseCaseProof, canUseDepartment, caseProofDepartments } from "@/lib/case-proof/audience";
import { checkCasePhoto } from "@/lib/case-proof/files";
import { requestCaseDraft } from "@/lib/case-proof/ai-draft";
import { CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";
import { NAV_ITEMS } from "@/lib/i18n/labels";
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
  const context = { department: "Packing", uploader: "Supervisor Sami", employee: "Hossam", locale: "en" as const };
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
    expect(seen!.body.context).toEqual({ locale: "en", department: "Packing", uploader: "Supervisor Sami", employee: "Hossam" });
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
    const result = await requestCaseDraft({ image, context: { ...context, employee: `A\nB ${"y".repeat(500)}` }, env, fetchImpl });
    expect(body!.context.employee.length).toBeLessThanOrEqual(L.maxContextLength);
    expect(body!.context.employee).not.toContain("\n");
    expect(result.ok && result.text.length).toBe(L.maxDraftLength);
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
