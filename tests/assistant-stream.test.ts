import { describe, expect, it } from "vitest";
import type { BridgeEvent } from "@/lib/assistant/claude-bridge";
import type { AssistantMessageDTO } from "@/lib/assistant/dto";
import { AssistantError } from "@/lib/assistant/errors";
import { createAnswerStream, type AnswerStreamDeps, type BrowserEvent } from "@/lib/assistant/stream";
import { readEventStream } from "@/lib/assistant/stream-client";

const msg = (role: "user" | "assistant", content: string): AssistantMessageDTO => ({ id: role, role, content, createdAt: "2026-09-20T10:00:00.000Z" });

function deps(events: BridgeEvent[] | ((signal: AbortSignal) => AsyncIterable<BridgeEvent>), over: Partial<AnswerStreamDeps> = {}) {
  const calls = { saved: [] as string[], finished: 0 };
  const d: AnswerStreamDeps = {
    events:
      typeof events === "function"
        ? events
        : async function* () {
            yield* events;
          },
    save: async (answer) => {
      calls.saved.push(answer);
      return [msg("user", "q"), msg("assistant", answer)];
    },
    describeError: (e) => (e instanceof AssistantError ? `ERR:${e.code}` : "ERR:other"),
    finish: () => {
      calls.finished += 1;
    },
    ...over,
  };
  return { d, calls };
}

async function run(d: AnswerStreamDeps) {
  const out: BrowserEvent[] = [];
  await readEventStream(createAnswerStream(d), (e) => out.push(e));
  return out;
}

describe("the answer stream", () => {
  it("passes the pieces on, saves the finished exchange and sends it", async () => {
    const { d, calls } = deps([
      { type: "delta", text: "اتنين " },
      { type: "tool" },
      { type: "delta", text: "غايبين" },
      { type: "done", answer: "اتنين غايبين", toolsUsed: [] },
    ]);
    const out = await run(d);
    expect(out.map((e) => e.type)).toEqual(["delta", "tool", "delta", "saved"]);
    expect(out[3]).toMatchObject({ type: "saved", messages: [{ role: "user" }, { role: "assistant", content: "اتنين غايبين" }] });
    expect(calls.saved).toEqual(["اتنين غايبين"]);
    expect(calls.finished).toBe(1);
  });

  it("saves nothing and says why when the assistant fails half way", async () => {
    const { d, calls } = deps(async function* () {
      yield { type: "delta", text: "نص" } as BridgeEvent;
      throw new AssistantError("timeout", "slow");
    });
    const out = await run(d);
    expect(out).toEqual([
      { type: "delta", text: "نص" },
      { type: "error", message: "ERR:timeout" },
    ]);
    expect(calls.saved).toEqual([]);
    expect(calls.finished).toBe(1);
  });

  it("reports a stream that ends without an answer", async () => {
    const { d, calls } = deps([{ type: "delta", text: "نص" }]);
    expect((await run(d)).at(-1)).toEqual({ type: "error", message: "ERR:other" });
    expect(calls.finished).toBe(1);
  });

  it("reports a failure to save", async () => {
    const { d } = deps([{ type: "done", answer: "x", toolsUsed: [] }], {
      save: async () => {
        throw new Error("db down");
      },
    });
    expect((await run(d)).at(-1)).toEqual({ type: "error", message: "ERR:other" });
  });

  it("drops the request and frees the user when the reader goes away", async () => {
    let signalSeen: AbortSignal | undefined;
    const { d, calls } = deps(async function* (signal) {
      signalSeen = signal;
      yield { type: "delta", text: "بداية" } as BridgeEvent;
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      throw new AssistantError("unavailable", "cancelled");
    });
    const reader = createAnswerStream(d).getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(signalSeen?.aborted).toBe(true);
    expect(calls.saved).toEqual([]);
    expect(calls.finished).toBe(1);
  });
});

describe("reading the stream in the browser", () => {
  it("handles lines cut anywhere, and skips a broken one", async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode(`${JSON.stringify({ type: "delta", text: "مرحبا" })}\nnot json\n${JSON.stringify({ type: "tool" })}\n`);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 19)); // cuts an Arabic letter in half
        c.enqueue(bytes.slice(19));
        c.close();
      },
    });
    const out: BrowserEvent[] = [];
    await readEventStream(body, (e) => out.push(e));
    expect(out).toEqual([{ type: "delta", text: "مرحبا" }, { type: "tool" }]);
  });
});
