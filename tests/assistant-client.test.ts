import { describe, expect, it } from "vitest";
import { askClaude } from "@/lib/assistant/claude-bridge";
import { AssistantError } from "@/lib/assistant/errors";

const base = {
  question: "كام غايب النهارده؟",
  history: [{ role: "user" as const, content: "سؤال قبل كده" }],
  context: { userName: "الأدمن", today: "2026-09-20", locale: "ar" as const, snapshot: { headcount: 3 } },
  toolToken: "tok",
};
const env = { ASSISTANT_BRIDGE_SECRET: "shh", PORT: "80" };

const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AssistantError | null)?.code;

describe("asking the assistant service", () => {
  it("sends the question with the secret and the tool token, and returns the answer", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, answer: "  اتنين غايبين  ", toolsUsed: ["attendance_summary", 5] }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await askClaude({ ...base, env, fetchImpl });
    expect(out).toEqual({ answer: "اتنين غايبين", toolsUsed: ["attendance_summary"] });
    expect(seen?.url).toBe("http://127.0.0.1:4100/ask");
    expect((seen?.init.headers as Record<string, string>)["x-bridge-secret"]).toBe("shh");
    const body = JSON.parse(String(seen?.init.body));
    expect(body).toMatchObject({ question: base.question, toolToken: "tok", toolUrl: "http://127.0.0.1:80/api/assistant/tool", history: base.history });
    expect(body.context.snapshot).toEqual({ headcount: 3 });
  });

  it("uses the configured addresses", async () => {
    let url = "";
    let toolUrl = "";
    const fetchImpl = (async (u: string, init: RequestInit) => {
      url = u;
      toolUrl = JSON.parse(String(init.body)).toolUrl;
      return new Response(JSON.stringify({ answer: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;
    await askClaude({
      ...base,
      env: { ...env, ASSISTANT_BRIDGE_URL: "http://127.0.0.1:5000/", ASSISTANT_TOOL_URL: "http://127.0.0.1:8080/api/assistant/tool" },
      fetchImpl,
    });
    expect(url).toBe("http://127.0.0.1:5000/ask");
    expect(toolUrl).toBe("http://127.0.0.1:8080/api/assistant/tool");
  });

  it("is not configured without the shared secret", async () => {
    expect(await code(askClaude({ ...base, env: {}, fetchImpl: reply(200, { answer: "x" }) }))).toBe("not_configured");
  });

  it.each([
    [503, "auth", "auth"],
    [429, "rate_limited", "rate_limited"],
    [429, "busy", "busy"],
    [504, "timeout", "timeout"],
    [502, "unavailable", "unavailable"],
    [502, "something-new", "unavailable"],
  ])("maps the service's HTTP %i %s to %s", async (status, c, expected) => {
    expect(await code(askClaude({ ...base, env, fetchImpl: reply(status, { ok: false, code: c, message: "m" }) }))).toBe(expected);
  });

  it("treats an empty answer as a bad response", async () => {
    expect(await code(askClaude({ ...base, env, fetchImpl: reply(200, { answer: "   " }) }))).toBe("bad_response");
    expect(await code(askClaude({ ...base, env, fetchImpl: reply(200, {}) }))).toBe("bad_response");
  });

  it("reports the service as unavailable when it can't be reached", async () => {
    const down = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    expect(await code(askClaude({ ...base, env, fetchImpl: down }))).toBe("unavailable");
  });

  it("gives up with a timeout when the service hangs", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    expect(await code(askClaude({ ...base, env, fetchImpl: hang, timeoutMs: 30 }))).toBe("timeout");
  });
});
