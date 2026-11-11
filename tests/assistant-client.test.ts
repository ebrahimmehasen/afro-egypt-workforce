import { describe, expect, it } from "vitest";
import { streamClaude, type BridgeEvent } from "@/lib/assistant/claude-bridge";
import { AssistantError } from "@/lib/assistant/errors";

const base = {
  question: "كام غايب النهارده؟",
  history: [{ role: "user" as const, content: "سؤال قبل كده" }],
  context: { userName: "الأدمن", today: "2026-09-20", locale: "ar" as const, snapshot: { headcount: 3 } },
  toolToken: "tok",
};
const env = { ASSISTANT_BRIDGE_SECRET: "shh", PORT: "80" };

const lines = (...events: unknown[]) => events.map((e) => `${JSON.stringify(e)}\n`);

/** A response whose body arrives in the given pieces, so a test can cut it wherever it likes. */
function streaming(pieces: string[], status = 200): typeof fetch {
  return (async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of pieces) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    return new Response(body, { status });
  }) as typeof fetch;
}
const replyJson = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

async function collect(gen: AsyncGenerator<BridgeEvent>) {
  const out: BridgeEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const failure = async (gen: AsyncGenerator<BridgeEvent>) => ((await collect(gen).then(() => null, (e) => e)) as AssistantError | null)?.code;

describe("asking the assistant service", () => {
  it("sends the question with the secret and the tool token, and yields what comes back as it arrives", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const inner = streaming(lines({ type: "delta", text: "اتنين " }, { type: "delta", text: "غايبين" }, { type: "done", answer: "  اتنين غايبين  ", toolsUsed: ["attendance_summary", 5] }));
    const fetchImpl = ((url: string, init: RequestInit) => {
      seen = { url, init };
      return inner(url, init);
    }) as unknown as typeof fetch;

    const out = await collect(streamClaude({ ...base, env, fetchImpl }));
    expect(out).toEqual([
      { type: "delta", text: "اتنين " },
      { type: "delta", text: "غايبين" },
      { type: "done", answer: "اتنين غايبين", toolsUsed: ["attendance_summary"] },
    ]);
    expect(seen?.url).toBe("http://127.0.0.1:4100/ask-stream");
    expect((seen?.init.headers as Record<string, string>)["x-bridge-secret"]).toBe("shh");
    const body = JSON.parse(String(seen?.init.body));
    expect(body).toMatchObject({ question: base.question, toolToken: "tok", toolUrl: "http://127.0.0.1:80/api/assistant/tool", history: base.history });
    expect(body.context.snapshot).toEqual({ headcount: 3 });
  });

  it("puts a line back together when the network cut it in two", async () => {
    const whole = lines({ type: "delta", text: "مرحبا" }, { type: "tool" }, { type: "done", answer: "تمام", toolsUsed: [] }).join("");
    const out = await collect(streamClaude({ ...base, env, fetchImpl: streaming([whole.slice(0, 7), whole.slice(7, 30), whole.slice(30)]) }));
    expect(out.map((e) => e.type)).toEqual(["delta", "tool", "done"]);
  });

  it("uses the configured addresses", async () => {
    let url = "";
    let toolUrl = "";
    const fetchImpl = ((u: string, init: RequestInit) => {
      url = u;
      toolUrl = JSON.parse(String(init.body)).toolUrl;
      return streaming(lines({ type: "done", answer: "ok" }))(u, init);
    }) as unknown as typeof fetch;
    await collect(
      streamClaude({
        ...base,
        env: { ...env, ASSISTANT_BRIDGE_URL: "http://127.0.0.1:5000/", ASSISTANT_TOOL_URL: "http://127.0.0.1:8080/api/assistant/tool" },
        fetchImpl,
      }),
    );
    expect(url).toBe("http://127.0.0.1:5000/ask-stream");
    expect(toolUrl).toBe("http://127.0.0.1:8080/api/assistant/tool");
  });

  it("is not configured without the shared secret", async () => {
    expect(await failure(streamClaude({ ...base, env: {}, fetchImpl: streaming([]) }))).toBe("not_configured");
  });

  it.each([
    [503, "auth", "auth"],
    [429, "rate_limited", "rate_limited"],
    [429, "busy", "busy"],
    [504, "timeout", "timeout"],
    [502, "unavailable", "unavailable"],
    [502, "something-new", "unavailable"],
  ])("maps the service's HTTP %i %s to %s", async (status, c, expected) => {
    expect(await failure(streamClaude({ ...base, env, fetchImpl: replyJson(status, { ok: false, code: c, message: "m" }) }))).toBe(expected);
  });

  it("raises an error event that arrives in the middle of the stream", async () => {
    const fetchImpl = streaming(lines({ type: "delta", text: "نص" }, { type: "error", code: "rate_limited", message: "limit" }));
    const seen: string[] = [];
    let code: string | undefined;
    try {
      for await (const e of streamClaude({ ...base, env, fetchImpl })) seen.push(e.type);
    } catch (e) {
      code = (e as AssistantError).code;
    }
    expect(seen).toEqual(["delta"]);
    expect(code).toBe("rate_limited");
  });

  it("treats an empty answer, or a stream that stops short, as a bad response", async () => {
    expect(await failure(streamClaude({ ...base, env, fetchImpl: streaming(lines({ type: "done", answer: "   " })) }))).toBe("bad_response");
    expect(await failure(streamClaude({ ...base, env, fetchImpl: streaming(lines({ type: "delta", text: "نص" })) }))).toBe("bad_response");
  });

  it("reports the service as unavailable when it can not be reached", async () => {
    const down = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    expect(await failure(streamClaude({ ...base, env, fetchImpl: down }))).toBe("unavailable");
  });

  it("gives up with a timeout when the service hangs", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    expect(await failure(streamClaude({ ...base, env, fetchImpl: hang, timeoutMs: 30 }))).toBe("timeout");
  });

  it("passes a cancel on to the request to the service", async () => {
    let aborted = false;
    const fetchImpl = ((_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = failure(streamClaude({ ...base, env, fetchImpl, signal: controller.signal }));
    controller.abort();
    expect(await pending).toBe("unavailable");
    expect(aborted).toBe(true);
  });
});
