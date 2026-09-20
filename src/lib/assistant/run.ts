import { TOOL_DEFINITIONS, ToolContext, buildSnapshot, executeTool } from "@/lib/assistant/employee-tools";
import { AssistantError, ChatFn, ChatMessage, ToolCall, chatCompletion, cleanAnswer } from "@/lib/assistant/nvidia";
import { buildSystemPrompt } from "@/lib/assistant/system-prompt";

/** How many tool round-trips one question may take before we stop and answer with what we have. */
const MAX_STEPS = 6;
/** Older turns beyond this are dropped from what the model sees (they stay saved for the user). */
const MAX_HISTORY = 16;
/** A single tool result is cut to this many characters so one huge answer can't crowd out the rest. */
const MAX_TOOL_CHARS = 14_000;

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantRun {
  answer: string;
  toolsUsed: string[];
  model: string;
}

/** Primary model first, then the fallback if the primary is missing, down or too slow. */
export function configuredModels(env: Record<string, string | undefined> = process.env): string[] {
  // The flagship: the strongest analysis of the models this key can use, but the slowest on the free tier.
  const primary = env.ASSISTANT_MODEL || "nvidia/nemotron-3-ultra-550b-a55b";
  const fallback = env.ASSISTANT_FALLBACK_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

function toolResultText(result: unknown): string {
  const text = JSON.stringify(result);
  return text.length > MAX_TOOL_CHARS ? `${text.slice(0, MAX_TOOL_CHARS)}… [truncated — ask a narrower question for the rest]` : text;
}

function runToolCall(call: ToolCall, ctx: ToolContext): string {
  let args: unknown = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return JSON.stringify({ error: "The arguments were not valid JSON." });
  }
  try {
    return toolResultText(executeTool(call.function.name, args, ctx));
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "The tool failed." });
  }
}

// Errors worth handing to the fallback model. Rate limits are per model, so a rate-limited one is included.
const FALL_BACK_ON: AssistantError["code"][] = ["unavailable", "timeout", "bad_response", "rate_limited", "model_missing"];
// A hosted free-tier model now and then fails fast with a server error and works on the very next try, so
// these get one immediate retry on the same model first. A timeout has already cost its full wait, a rate
// limit or a missing model won't clear by asking again.
const RETRY_SAME_MODEL_ON: AssistantError["code"][] = ["unavailable", "bad_response"];

/** Longest a single model call may take, and the most a whole question may take across all its calls. */
const CALL_TIMEOUT_MS = 75_000;
const TOTAL_BUDGET_MS = 150_000;

export async function runAssistant(opts: {
  question: string;
  history: HistoryTurn[];
  ctx: ToolContext;
  userName: string;
  chat?: ChatFn;
  models?: string[];
  retryDelayMs?: number;
}): Promise<AssistantRun> {
  const chat = opts.chat ?? chatCompletion;
  const models = opts.models ?? configuredModels();

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({ today: opts.ctx.today, locale: opts.ctx.locale, userName: opts.userName, snapshot: buildSnapshot(opts.ctx) }),
    },
    ...opts.history.slice(-MAX_HISTORY).map((h): ChatMessage => ({ role: h.role, content: h.content })),
    { role: "user", content: opts.question },
  ];

  const toolsUsed: string[] = [];
  let modelIndex = 0;
  const startedAt = Date.now();
  const timeLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  const callTimeout = () => {
    if (timeLeft() < 5_000) throw new AssistantError("timeout", "The question took too long to answer");
    return Math.min(CALL_TIMEOUT_MS, timeLeft());
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    let reply: Awaited<ReturnType<ChatFn>> | undefined;
    // one call: retry a fast server error once on the same model, and only then walk down the model list
    let retried = false;
    while (!reply) {
      const model = models[modelIndex];
      try {
        reply = await chat({ model, messages, tools: TOOL_DEFINITIONS, timeoutMs: callTimeout() });
      } catch (e) {
        if (!(e instanceof AssistantError)) throw e;
        if (!retried && RETRY_SAME_MODEL_ON.includes(e.code)) {
          retried = true;
          await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 500));
          continue;
        }
        if (FALL_BACK_ON.includes(e.code) && modelIndex < models.length - 1) {
          modelIndex += 1;
          retried = false;
          continue;
        }
        throw e;
      }
    }

    const { message } = reply;
    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      const answer = cleanAnswer(message.content);
      if (!answer) throw new AssistantError("bad_response", "The model returned an empty answer");
      return { answer, toolsUsed, model: models[modelIndex] };
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      toolsUsed.push(call.function.name);
      messages.push({ role: "tool", tool_call_id: call.id, content: runToolCall(call, opts.ctx) });
    }
  }

  // Out of steps: ask once, without tools, for the best answer from what has been gathered.
  messages.push({ role: "user", content: "Answer now using only the tool results above." });
  const last = await chat({ model: models[modelIndex], messages, timeoutMs: callTimeout() });
  const answer = cleanAnswer(last.message.content);
  if (!answer) throw new AssistantError("bad_response", "The model returned an empty answer");
  return { answer, toolsUsed, model: models[modelIndex] };
}
