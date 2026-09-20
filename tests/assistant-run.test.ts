import { describe, expect, it, vi } from "vitest";
import { AssistantError, ChatFn, ChatMessage, cleanAnswer } from "@/lib/assistant/nvidia";
import { configuredModels, runAssistant } from "@/lib/assistant/run";
import { ctx } from "./helpers/assistant-fixture";

const answer = (content: string): Awaited<ReturnType<ChatFn>> => ({ message: { role: "assistant", content }, finish: "stop" });
const toolCall = (name: string, args: unknown, id = "call_1"): Awaited<ReturnType<ChatFn>> => ({
  message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } }] },
  finish: "tool_calls",
});

const base = { question: "مين ناقصه أوراق؟", history: [], ctx, userName: "المدير", models: ["primary/model"], retryDelayMs: 0 };
const messagesOf = (chat: ReturnType<typeof vi.fn>, call = 0) => (chat.mock.calls[call][0] as { messages: ChatMessage[] }).messages;

describe("runAssistant", () => {
  it("returns a direct answer when no data is needed", async () => {
    const chat = vi.fn(async () => answer("أهلاً"));
    expect(await runAssistant({ ...base, chat })).toMatchObject({ answer: "أهلاً", toolsUsed: [], model: "primary/model" });
  });

  it("runs the requested tool against the user's own data and feeds the result back", async () => {
    const chat = vi
      .fn<ChatFn>()
      .mockResolvedValueOnce(toolCall("find_data_gaps", {}))
      .mockResolvedValueOnce(answer("عندك موظفين ناقصهم أوراق"));
    const run = await runAssistant({ ...base, chat });

    expect(run.toolsUsed).toEqual(["find_data_gaps"]);
    expect(run.answer).toBe("عندك موظفين ناقصهم أوراق");
    const second = messagesOf(chat, 1);
    const toolMsg = second.find((m) => m.role === "tool")!;
    expect(toolMsg.tool_call_id).toBe("call_1");
    expect(JSON.parse(toolMsg.content!)).toHaveProperty("employeesWithGaps");
  });

  it("starts every conversation with the system prompt and puts saved history before the question", async () => {
    const chat = vi.fn(async () => answer("تمام"));
    await runAssistant({
      ...base,
      chat,
      history: [
        { role: "user", content: "سؤال قديم" },
        { role: "assistant", content: "رد قديم" },
      ],
    });
    const m = messagesOf(chat);
    expect(m[0].role).toBe("system");
    expect(m[0].content).toContain("GROUNDING");
    expect(m.slice(1).map((x) => x.content)).toEqual(["سؤال قديم", "رد قديم", "مين ناقصه أوراق؟"]);
  });

  it("hands the model the company-wide snapshot, and no individual's details, with every question", async () => {
    const chat = vi.fn(async () => answer("تمام"));
    await runAssistant({ ...base, chat });
    const system = messagesOf(chat)[0].content!;
    expect(system).toContain("COMPANY SNAPSHOT");
    // the instructions above the snapshot mention an example code, so only the data part is checked
    const snapshot = system.slice(system.indexOf("COMPANY SNAPSHOT"));
    expect(snapshot).toContain('"headcount"');
    for (const person of ["سامي", "منى", "PROD-001", "TBD-001", "secret-id"]) expect(snapshot).not.toContain(person);
  });

  it("caps how much history the model sees", async () => {
    const chat = vi.fn(async () => answer("تمام"));
    const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `m${i}` }));
    await runAssistant({ ...base, chat, history });
    expect(messagesOf(chat)).toHaveLength(1 + 16 + 1);
    expect(messagesOf(chat).at(-2)!.content).toBe("m39");
  });

  it("never lets an internal database id reach the model", async () => {
    const chat = vi
      .fn<ChatFn>()
      .mockResolvedValueOnce(toolCall("get_employee", { query: "PROD-001" }))
      .mockResolvedValueOnce(toolCall("search_employees", { query: "سامي" }, "call_2"))
      .mockResolvedValueOnce(answer("تمام"));
    await runAssistant({ ...base, chat });
    for (let i = 0; i < chat.mock.calls.length; i++) expect(JSON.stringify(messagesOf(chat, i))).not.toContain("secret-id");
  });

  it("survives malformed tool arguments and tells the model what went wrong", async () => {
    const chat = vi.fn<ChatFn>().mockResolvedValueOnce(toolCall("search_employees", "{not json")).mockResolvedValueOnce(answer("تمام"));
    await runAssistant({ ...base, chat });
    const toolMsg = messagesOf(chat, 1).find((m) => m.role === "tool")!;
    expect(JSON.parse(toolMsg.content!)).toEqual({ error: "The arguments were not valid JSON." });
  });

  it("answers with an error result for a tool that doesn't exist instead of failing", async () => {
    const chat = vi.fn<ChatFn>().mockResolvedValueOnce(toolCall("delete_everything", {})).mockResolvedValueOnce(answer("مقدرش"));
    const run = await runAssistant({ ...base, chat });
    expect(run.answer).toBe("مقدرش");
    expect(JSON.parse(messagesOf(chat, 1).find((m) => m.role === "tool")!.content!)).toEqual({ error: "Unknown tool: delete_everything" });
  });

  it("falls back to the second model when the first is unavailable", async () => {
    const chat = vi.fn<ChatFn>().mockImplementation(async ({ model }) => {
      if (model === "primary/model") throw new AssistantError("unavailable", "down");
      return answer("من الاحتياطي");
    });
    const run = await runAssistant({ ...base, chat, models: ["primary/model", "backup/model"] });
    expect(run).toMatchObject({ answer: "من الاحتياطي", model: "backup/model" });
  });

  it("retries a fast server error once on the same model before giving up on it", async () => {
    const chat = vi.fn<ChatFn>().mockRejectedValueOnce(new AssistantError("unavailable", "HTTP 500")).mockResolvedValueOnce(answer("نجحت المرة التانية"));
    const run = await runAssistant({ ...base, chat, models: ["primary/model", "backup/model"] });
    expect(run).toMatchObject({ answer: "نجحت المرة التانية", model: "primary/model" });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("goes to the fallback once the retry has failed too", async () => {
    const seen: string[] = [];
    const chat = vi.fn<ChatFn>().mockImplementation(async ({ model }) => {
      seen.push(model);
      if (model === "primary/model") throw new AssistantError("unavailable", "HTTP 500");
      return answer("من الاحتياطي");
    });
    await runAssistant({ ...base, chat, models: ["primary/model", "backup/model"] });
    expect(seen).toEqual(["primary/model", "primary/model", "backup/model"]);
  });

  it("doesn't retry a timeout, a rate limit or a missing model — it moves straight on", async () => {
    for (const code of ["timeout", "rate_limited", "model_missing"] as const) {
      const seen: string[] = [];
      const chat = vi.fn<ChatFn>().mockImplementation(async ({ model }) => {
        seen.push(model);
        if (model === "primary/model") throw new AssistantError(code, code);
        return answer("من الاحتياطي");
      });
      await runAssistant({ ...base, chat, models: ["primary/model", "backup/model"] });
      expect(seen).toEqual(["primary/model", "backup/model"]);
    }
  });

  it("also hands over to the fallback when the first model is rate-limited", async () => {
    const chat = vi.fn<ChatFn>().mockImplementation(async ({ model }) => {
      if (model === "primary/model") throw new AssistantError("rate_limited", "429");
      return answer("من الاحتياطي");
    });
    expect((await runAssistant({ ...base, chat, models: ["primary/model", "backup/model"] })).model).toBe("backup/model");
  });

  it("gives every model call a time limit, so a stuck model can't hold the question forever", async () => {
    const chat = vi.fn<ChatFn>(async () => answer("تمام"));
    await runAssistant({ ...base, chat });
    const { timeoutMs } = chat.mock.calls[0][0] as { timeoutMs: number };
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(75_000);
  });

  it("does not hide a rejected key behind the fallback", async () => {
    const chat = vi.fn<ChatFn>().mockRejectedValue(new AssistantError("auth", "bad key"));
    await expect(runAssistant({ ...base, chat, models: ["a", "b"] })).rejects.toMatchObject({ code: "auth" });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("stops looping after the step limit and asks for a final answer without tools", async () => {
    const chat = vi.fn<ChatFn>(async ({ tools }) => (tools ? toolCall("company_overview", {}) : answer("خلاصة")));
    const run = await runAssistant({ ...base, chat });
    expect(run.answer).toBe("خلاصة");
    expect(chat).toHaveBeenCalledTimes(7); // 6 tool rounds + the final no-tools call
    expect((chat.mock.calls.at(-1)![0] as { tools?: unknown }).tools).toBeUndefined();
  });

  it("refuses an empty answer", async () => {
    const chat = vi.fn(async () => answer("  <think>hmm</think>  "));
    await expect(runAssistant({ ...base, chat })).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("cleanAnswer", () => {
  it("removes reasoning blocks and surrounding whitespace", () => {
    expect(cleanAnswer("<think>plan\nmore plan</think>\n\nالرد")).toBe("الرد");
    expect(cleanAnswer("plan text</think>الرد")).toBe("الرد");
    expect(cleanAnswer(null)).toBe("");
  });
});

describe("configuredModels", () => {
  it("uses the primary alone, or primary then fallback", () => {
    expect(configuredModels({ ASSISTANT_MODEL: "a", ASSISTANT_FALLBACK_MODEL: "" })).toEqual(["a"]);
    expect(configuredModels({ ASSISTANT_MODEL: "a", ASSISTANT_FALLBACK_MODEL: "b" })).toEqual(["a", "b"]);
    expect(configuredModels({ ASSISTANT_MODEL: "a", ASSISTANT_FALLBACK_MODEL: "a" })).toEqual(["a"]);
  });

  it("defaults to the flagship with the faster model behind it", () => {
    expect(configuredModels({})).toEqual(["nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b"]);
  });
});
