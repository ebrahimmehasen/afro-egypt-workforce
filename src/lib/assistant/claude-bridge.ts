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

export interface BridgeAnswer {
  answer: string;
  toolsUsed: string[];
}

/** Longer than the service's own limit, so that its clearer error arrives first. */
const REQUEST_TIMEOUT_MS = 170_000;

const CODES: AssistantErrorCode[] = ["not_configured", "auth", "rate_limited", "unavailable", "timeout", "bad_response", "busy"];

export async function askClaude(opts: {
  question: string;
  history: HistoryTurn[];
  context: BridgeContext;
  toolToken: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<BridgeAnswer> {
  const env = opts.env ?? process.env;
  const secret = env.ASSISTANT_BRIDGE_SECRET;
  if (!secret) throw new AssistantError("not_configured", "ASSISTANT_BRIDGE_SECRET is not set");

  const base = (env.ASSISTANT_BRIDGE_URL || "http://127.0.0.1:4100").replace(/\/+$/, "");
  const toolUrl = env.ASSISTANT_TOOL_URL || `http://127.0.0.1:${env.PORT || 3000}/api/assistant/tool`;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${base}/ask`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-bridge-secret": secret },
      body: JSON.stringify({ question: opts.question, history: opts.history, context: opts.context, toolUrl, toolToken: opts.toolToken }),
    });
    const json = (await res.json().catch(() => null)) as { answer?: unknown; toolsUsed?: unknown; code?: unknown; message?: unknown } | null;

    if (!res.ok) {
      const code = CODES.find((c) => c === json?.code) ?? "unavailable";
      throw new AssistantError(code, typeof json?.message === "string" ? json.message : `The assistant service answered HTTP ${res.status}`);
    }
    if (typeof json?.answer !== "string" || !json.answer.trim()) throw new AssistantError("bad_response", "The assistant service returned an empty answer");
    return { answer: json.answer.trim(), toolsUsed: Array.isArray(json.toolsUsed) ? json.toolsUsed.filter((x): x is string => typeof x === "string") : [] };
  } catch (e) {
    if (e instanceof AssistantError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new AssistantError("timeout", `The assistant didn't answer within ${timeoutMs / 1000}s`);
    throw new AssistantError("unavailable", `The assistant service is not reachable: ${e instanceof Error ? e.message : "network error"}`);
  } finally {
    clearTimeout(timer);
  }
}
