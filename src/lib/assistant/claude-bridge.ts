import { AssistantError, type AssistantErrorCode } from "@/lib/assistant/errors";

// Server-only: asks the assistant service (assistant-bridge/) a question. That service runs the Claude CLI on
// this machine under the account that is signed in there, and the CLI reaches back into the app only through
// read-only tools, with the token handed over here. The secret never reaches the browser.

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BridgeContext {
  userName: string;
  today: string;
  locale: "ar" | "en";
  /** Company-wide figures; aggregates only. */
  snapshot: unknown;
}

/** What the service tells us while it answers: a piece of the text, a lookup starting, and finally the whole answer. */
export type BridgeEvent =
  | { type: "delta"; text: string }
  | { type: "tool" }
  | { type: "done"; answer: string; toolsUsed: string[] };

/** Longer than the service's own limit, so that its clearer error arrives first. */
const REQUEST_TIMEOUT_MS = 170_000;

const CODES: AssistantErrorCode[] = ["not_configured", "auth", "rate_limited", "unavailable", "timeout", "bad_response", "busy"];

const asCode = (value: unknown): AssistantErrorCode => CODES.find((c) => c === value) ?? "unavailable";

/**
 * Asks one question and yields the answer as the service writes it. Throws an AssistantError for anything that
 * goes wrong, before or in the middle of the answer. `signal` stops the request (and with it the CLI behind it).
 */
export async function* streamClaude(opts: {
  question: string;
  history: HistoryTurn[];
  context: BridgeContext;
  toolToken: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}): AsyncGenerator<BridgeEvent, void, undefined> {
  const env = opts.env ?? process.env;
  const secret = env.ASSISTANT_BRIDGE_SECRET;
  if (!secret) throw new AssistantError("not_configured", "ASSISTANT_BRIDGE_SECRET is not set");

  const base = (env.ASSISTANT_BRIDGE_URL || "http://127.0.0.1:4100").replace(/\/+$/, "");
  const toolUrl = env.ASSISTANT_TOOL_URL || `http://127.0.0.1:${env.PORT || 3000}/api/assistant/tool`;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  else opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    let res: Response;
    try {
      res = await (opts.fetchImpl ?? fetch)(`${base}/ask-stream`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-bridge-secret": secret },
        body: JSON.stringify({ question: opts.question, history: opts.history, context: opts.context, toolUrl, toolToken: opts.toolToken }),
      });
    } catch (e) {
      throw reachFailure(e, opts.signal, timeoutMs);
    }

    if (!res.ok || !res.body) {
      const json = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
      throw new AssistantError(asCode(json?.code), typeof json?.message === "string" ? json.message : `The assistant service answered HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let finished = false;

    const parse = (line: string): BridgeEvent | null => {
      if (!line.trim()) return null;
      let ev: { type?: unknown; text?: unknown; answer?: unknown; toolsUsed?: unknown; code?: unknown; message?: unknown };
      try {
        ev = JSON.parse(line);
      } catch {
        return null;
      }
      if (ev.type === "delta" && typeof ev.text === "string") return { type: "delta", text: ev.text };
      if (ev.type === "tool") return { type: "tool" };
      if (ev.type === "done") {
        if (typeof ev.answer !== "string" || !ev.answer.trim()) throw new AssistantError("bad_response", "The assistant service returned an empty answer");
        return { type: "done", answer: ev.answer.trim(), toolsUsed: Array.isArray(ev.toolsUsed) ? ev.toolsUsed.filter((x): x is string => typeof x === "string") : [] };
      }
      if (ev.type === "error") throw new AssistantError(asCode(ev.code), typeof ev.message === "string" ? ev.message : "The assistant service failed");
      return null;
    };

    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          throw reachFailure(e, opts.signal, timeoutMs);
        }
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let i;
        while ((i = pending.indexOf("\n")) >= 0) {
          const ev = parse(pending.slice(0, i));
          pending = pending.slice(i + 1);
          if (ev) {
            yield ev;
            if (ev.type === "done") finished = true;
          }
        }
      }
      const last = parse(pending + decoder.decode());
      if (last) {
        yield last;
        if (last.type === "done") finished = true;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    if (!finished) throw new AssistantError("bad_response", "The assistant service ended without an answer");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

function reachFailure(e: unknown, outer: AbortSignal | undefined, timeoutMs: number): AssistantError {
  if (e instanceof AssistantError) return e;
  if (e instanceof Error && e.name === "AbortError") {
    return outer?.aborted ? new AssistantError("unavailable", "The question was cancelled") : new AssistantError("timeout", `The assistant didn't answer within ${timeoutMs / 1000}s`);
  }
  return new AssistantError("unavailable", `The assistant service is not reachable: ${e instanceof Error ? e.message : "network error"}`);
}
