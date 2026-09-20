// Server-only: calls NVIDIA's hosted, OpenAI-compatible chat API. The key comes from the environment and
// never reaches the browser.

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type AssistantErrorCode = "not_configured" | "auth" | "rate_limited" | "model_missing" | "unavailable" | "timeout" | "bad_response";

export class AssistantError extends Error {
  constructor(
    public readonly code: AssistantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: readonly unknown[];
  timeoutMs?: number;
  maxTokens?: number;
}

export type ChatFn = (req: ChatRequest) => Promise<{ message: ChatMessage; finish: string | null }>;

/** Reasoning models sometimes put their working in <think> tags inside the answer; that isn't for the reader. */
export function cleanAnswer(content: string | null | undefined): string {
  return (content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "") // a closing tag with no opening one
    .trim();
}

export const chatCompletion: ChatFn = async ({ model, messages, tools, timeoutMs = 60_000, maxTokens = 1800 }) => {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new AssistantError("not_configured", "NVIDIA_API_KEY is not set");
  const base = (process.env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
      }),
    });

    if (!res.ok) {
      // the start of the body says why (bad request shape, overloaded, ...) and is safe to log: it never echoes the key
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new AssistantError("auth", `NVIDIA API rejected the key (HTTP ${res.status})`);
      if (res.status === 429) throw new AssistantError("rate_limited", "NVIDIA API rate limit reached");
      if (res.status === 404) throw new AssistantError("model_missing", `Model not available: ${model}`);
      throw new AssistantError("unavailable", `NVIDIA API error (HTTP ${res.status}) [${model}]: ${detail}`);
    }

    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: ChatMessage; finish_reason?: string }[];
    } | null;
    const choice = json?.choices?.[0];
    if (!choice?.message) throw new AssistantError("bad_response", "Empty response from the model");
    return { message: choice.message, finish: choice.finish_reason ?? null };
  } catch (e) {
    if (e instanceof AssistantError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new AssistantError("timeout", `The model didn't answer within ${timeoutMs / 1000}s`);
    throw new AssistantError("unavailable", e instanceof Error ? e.message : "Network error");
  } finally {
    clearTimeout(timer);
  }
};
