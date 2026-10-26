import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Store } from "@/lib/store";
import type { Role } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { handleToolRequest, type ToolEndpointDeps } from "@/lib/assistant/tool-endpoint";
import { signToolToken } from "@/lib/assistant/tool-token";
import { store } from "./helpers/assistant-fixture";

const NOW = 1_000_000;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret-with-more-than-16-chars";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved;
});

const USERS: Record<string, { role: Role; active: boolean }> = {
  admin1: { role: "admin", active: true },
  admin2: { role: "admin", active: true },
  hr: { role: "hr", active: true },
  gone: { role: "admin", active: false },
};

const deps = (over: Partial<ToolEndpointDeps> = {}): ToolEndpointDeps => ({
  loadUser: async (uid) => USERS[uid] ?? null,
  loadStore: async () => store,
  dictionary: (loc) => (loc === "ar" ? ar : en),
  today: () => "2026-09-20",
  now: NOW + 1_000,
  ...over,
});

const bearer = (uid: string, loc: "ar" | "en" = "ar") => `Bearer ${signToolToken({ uid, loc }, NOW)}`;
const call = (auth: string | null, body: unknown, d = deps()) => handleToolRequest(auth, body, d);

describe("who may call the tools", () => {
  it("refuses a call with no token or a bad one", async () => {
    expect((await call(null, { op: "list" })).status).toBe(401);
    expect((await call("Bearer nonsense", { op: "list" })).status).toBe(401);
    expect((await call("", { op: "list" })).status).toBe(401);
  });

  it("refuses an expired token", async () => {
    const reply = await call(bearer("admin1"), { op: "list" }, deps({ now: NOW + 10 * 60_000 }));
    expect(reply.status).toBe(401);
  });

  it.each(["hr", "gone", "nobody"])("refuses a valid token for %s: only an active admin may use the assistant", async (uid) => {
    const reply = await call(bearer(uid), { op: "call", name: "company_overview", args: {} });
    expect(reply.status).toBe(403);
    expect(JSON.stringify(reply.json)).not.toContain("headcount");
  });

  it("lets an active admin in, and any other active admin too", async () => {
    expect((await call(bearer("admin1"), { op: "list" })).status).toBe(200);
    expect((await call(bearer("admin2"), { op: "list" })).status).toBe(200);
  });
});

describe("what it does", () => {
  it("lists the tools", async () => {
    const reply = await call(bearer("admin1"), { op: "list" });
    const names = (reply.json as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_employee", "attendance_summary", "payroll_overview"]));
  });

  it("runs a tool and hands back its result as text, in the asker's language", async () => {
    const reply = await call(bearer("admin1", "ar"), { op: "call", name: "attendance_summary", args: { date: "2026-09-19" } });
    expect(reply.status).toBe(200);
    const result = (reply.json as { result: string }).result;
    expect(JSON.parse(result).byStatus).toEqual({ متأخر: 1, غائب: 1 });
    expect(result).not.toContain("secret-id");
  });

  it("answers an unknown tool with an error the model can read, not a failure", async () => {
    const reply = await call(bearer("admin1"), { op: "call", name: "drop_everything", args: {} });
    expect(reply.status).toBe(200);
    expect(JSON.parse((reply.json as { result: string }).result).error).toMatch(/Unknown tool/);
  });

  it("reports a failing read as a tool error", async () => {
    const reply = await call(bearer("admin1"), { op: "call", name: "company_overview" }, deps({ loadStore: async () => Promise.reject(new Error("db down")) }));
    expect(reply.json).toMatchObject({ isError: true });
    expect((reply.json as { result: string }).result).toContain("db down");
  });

  it("hands the admin tools the requests, audit trail and accounts too", async () => {
    const extras = { changeRequests: [], workRequests: [], auditLog: [{ userName: "منى", action: "إضافة", module: "الموظفين", oldValue: "-", newValue: "x", reason: null, timestamp: "2026-09-18T07:00:00.000Z" }], users: [], holidays: [], devices: [], biometric: null };
    const reply = await call(bearer("admin1"), { op: "call", name: "audit_log" }, deps({ loadExtras: async () => extras }));
    expect(JSON.parse((reply.json as { result: string }).result).total).toBe(1);
  });

  it("cuts a huge result", async () => {
    const big = {
      ...store,
      employees: Array.from({ length: 60 }, (_, i) => ({ ...store.employees[0], id: `e${i}`, employeeNumber: `N-${i}`, name: `${"x".repeat(1000)}${i}` })),
    } as unknown as Store;
    const reply = await call(bearer("admin1"), { op: "call", name: "search_employees", args: { limit: 40 } }, deps({ loadStore: async () => big }));
    const result = (reply.json as { result: string }).result;
    expect(result.length).toBeLessThan(14_200);
    expect(result).toContain("truncated");
  });

  it("refuses a request that is neither a list nor a call", async () => {
    expect((await call(bearer("admin1"), { op: "write" })).status).toBe(400);
    expect((await call(bearer("admin1"), null)).status).toBe(400);
    expect((await call(bearer("admin1"), { op: "call" })).status).toBe(400);
  });
});
