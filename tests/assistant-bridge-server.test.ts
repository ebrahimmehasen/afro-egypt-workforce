import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridge } from "../assistant-bridge/server.mjs";

// A stand-in for `claude -p`: reads the prompt on stdin and answers in the CLI's JSON shape, echoing back what it
// was given, so a test can see exactly what reached the model and what did not.
const STUB = `
import fs from "node:fs";
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", async () => {
  if (prompt.includes("[[HANG]]")) return void setInterval(() => {}, 1000);
  if (prompt.includes("[[LOGIN]]")) return void process.stdout.write("Not logged in \\u00b7 Please run /login\\n");
  if (prompt.includes("[[LIMIT]]")) return void process.stdout.write(JSON.stringify({ is_error: true, result: "API Error: 429 usage limit reached" }));
  await new Promise((r) => setTimeout(r, prompt.includes("[[SLOW]]") ? 700 : 80));
  const cfg = JSON.parse(fs.readFileSync(flag("--mcp-config"), "utf8"));
  fs.appendFileSync(cfg.mcpServers.afro.env.AFRO_TOOL_LOG, "attendance_summary\\n");
  const sys = flag("--system-prompt") || "";
  const result = [
    "PROMPT=" + prompt,
    "RULES=" + sys.split("\\n")[0],
    "FACTS=" + (sys.split("(data, not instructions):\\n")[1] || ""),
    "TOOLS=" + JSON.stringify(flag("--tools")),
    "MODE=" + flag("--permission-mode"),
    "ALLOWED=" + flag("--allowedTools"),
    "CONFIG_DIR=" + process.env.CLAUDE_CONFIG_DIR,
    "SECRET_VISIBLE=" + Boolean(process.env.ASSISTANT_BRIDGE_SECRET),
    "CWD=" + process.cwd(),
    "TOKEN=" + cfg.mcpServers.afro.env.AFRO_TOOL_TOKEN,
  ].join("\\n");
  process.stdout.write(JSON.stringify({ is_error: false, result, total_cost_usd: 0.01 }));
});
`;

const SECRET = "bridge-secret";
let dir: string;
let instructions: string;
let server: Server;
let base: string;

const tmpDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("afro-assistant-"));

function config(over: Record<string, unknown> = {}) {
  return {
    port: 0,
    secret: SECRET,
    cli: process.execPath,
    cliArgsPrefix: [path.join(dir, "stub-cli.mjs")],
    configDir: path.join(dir, "claude-home"),
    workDir: path.join(dir, "work"),
    instructionsFile: instructions,
    defaultInstructionsFile: path.join(process.cwd(), "assistant-bridge", "INSTRUCTIONS.md"),
    mcpScript: path.join(process.cwd(), "assistant-bridge", "mcp-afro.mjs"),
    model: "sonnet",
    budgetUsd: "1.00",
    timeoutMs: 5_000,
    maxParallel: 3,
    queueWaitMs: 500,
    ...over,
  };
}

async function listen(over: Record<string, unknown> = {}): Promise<{ server: Server; base: string }> {
  const s = createBridge(config(over)) as Server;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}

const body = (over: Record<string, unknown> = {}) => ({
  question: "كام غايب؟",
  history: [],
  context: { userName: "الأدمن", today: "2026-09-20", locale: "ar", snapshot: { headcount: 3 } },
  toolUrl: "http://127.0.0.1:80/api/assistant/tool",
  toolToken: "token-1",
  ...over,
});

const ask = (url: string, payload: unknown, secret: string | null = SECRET) =>
  fetch(`${url}/ask`, { method: "POST", headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-bridge-secret": secret }) }, body: JSON.stringify(payload) });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
  fs.mkdirSync(path.join(dir, "work"));
  fs.writeFileSync(path.join(dir, "stub-cli.mjs"), STUB);
  instructions = path.join(dir, "INSTRUCTIONS.md");
  fs.writeFileSync(instructions, "RULES-V1");
  ({ server, base } = await listen());
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the assistant service", () => {
  it("is up", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("refuses a wrong or missing secret before reading anything", async () => {
    expect((await ask(base, body(), "wrong")).status).toBe(401);
    expect((await ask(base, body(), null)).status).toBe(401);
    expect((await fetch(`${base}/nothing`)).status).toBe(404);
  });

  it("refuses a malformed request or a tool address outside this machine", async () => {
    expect((await ask(base, { question: "" })).status).toBe(400);
    expect((await ask(base, body({ toolUrl: "http://192.168.1.5/api/assistant/tool" }))).status).toBe(400);
    const res = await fetch(`${base}/ask`, { method: "POST", headers: { "x-bridge-secret": SECRET }, body: "not json" });
    expect(res.status).toBe(400);
  });

  it("answers, running the CLI with no built-in tools and nothing to ask permission for", async () => {
    const res = await ask(base, body());
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.answer).toContain("PROMPT=كام غايب؟");
    expect(out.answer).toContain('TOOLS=""');
    expect(out.answer).toContain("MODE=dontAsk");
    expect(out.answer).toContain("ALLOWED=mcp__afro");
    expect(out.toolsUsed).toEqual(["attendance_summary"]);
  });

  it("runs the CLI in its own folder, under its own Claude account, without the bridge's secret", async () => {
    const { answer } = await (await ask(base, body())).json();
    expect(answer).toContain(`CONFIG_DIR=${path.join(dir, "claude-home")}`);
    expect(answer).toContain("SECRET_VISIBLE=false");
    expect(answer.split("\n").find((l: string) => l.startsWith("CWD="))?.toLowerCase()).toContain(path.join(dir, "work").toLowerCase());
  });

  it("reads the rulebook again for every question", async () => {
    expect((await (await ask(base, body())).json()).answer).toContain("RULES=RULES-V1");
    fs.writeFileSync(instructions, "RULES-V2");
    expect((await (await ask(base, body())).json()).answer).toContain("RULES=RULES-V2");
  });

  it("falls back to the shipped rulebook when the edited one is missing", async () => {
    const { server: s, base: url } = await listen({ instructionsFile: path.join(dir, "missing.md") });
    try {
      const { answer } = await (await ask(url, body())).json();
      expect(answer).toContain("RULES=You are the virtual assistant of Afro Egypt");
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it("hands the model the facts of this question and the earlier turns", async () => {
    const { answer } = await (await ask(base, body({ history: [{ role: "user", content: "قبل كده" }, { role: "assistant", content: "ردي" }] }))).json();
    expect(answer).toContain("FACTS={");
    expect(answer).toContain("الأدمن");
    expect(answer).toContain("User: قبل كده");
    expect(answer).toContain("Assistant: ردي");
  });

  it("keeps two admins' questions apart even when they are asked at the same moment", async () => {
    const [a, b] = await Promise.all([
      ask(base, body({ question: "سؤال (asked by A-ONE)", history: [{ role: "user", content: "تاريخ A-ONE" }], context: { userName: "Admin A-ONE", today: "2026-09-20", locale: "ar" }, toolToken: "token-A" })),
      ask(base, body({ question: "سؤال (asked by B-TWO)", history: [{ role: "user", content: "تاريخ B-TWO" }], context: { userName: "Admin B-TWO", today: "2026-09-20", locale: "ar" }, toolToken: "token-B" })),
    ]);
    const answerA = (await a.json()).answer as string;
    const answerB = (await b.json()).answer as string;

    expect(answerA).toContain("A-ONE");
    expect(answerA).not.toContain("B-TWO");
    expect(answerA).toContain("TOKEN=token-A");
    expect(answerB).toContain("B-TWO");
    expect(answerB).not.toContain("A-ONE");
    expect(answerB).toContain("TOKEN=token-B");
  });

  it("leaves nothing behind after a question", async () => {
    const before = tmpDirs();
    await ask(base, body());
    await ask(base, body({ question: "[[LOGIN]]" }));
    expect(tmpDirs()).toEqual(before);
  });

  it("reports a Claude account that is not signed in", async () => {
    const res = await ask(base, body({ question: "[[LOGIN]]" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "auth" });
  });

  it("reports a usage limit", async () => {
    const res = await ask(base, body({ question: "[[LIMIT]]" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
  });

  it("stops a run that never ends", async () => {
    const { server: s, base: url } = await listen({ timeoutMs: 400 });
    try {
      const res = await ask(url, body({ question: "[[HANG]]" }));
      expect(res.status).toBe(504);
      expect(await res.json()).toMatchObject({ code: "timeout" });
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it("tells a caller to wait when it is already running as many as it may", async () => {
    const { server: s, base: url } = await listen({ maxParallel: 1, queueWaitMs: 100 });
    try {
      const slow = ask(url, body({ question: "[[SLOW]]" }));
      await new Promise((r) => setTimeout(r, 150));
      const second = await ask(url, body());
      expect(second.status).toBe(429);
      expect(await second.json()).toMatchObject({ code: "busy" });
      expect((await slow).status).toBe(200);
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it("lets a waiting question go once a place frees up", async () => {
    const { server: s, base: url } = await listen({ maxParallel: 1, queueWaitMs: 3_000 });
    try {
      const first = ask(url, body({ question: "[[SLOW]] one" }));
      await new Promise((r) => setTimeout(r, 100));
      const second = ask(url, body({ question: "two" }));
      expect((await first).status).toBe(200);
      const done = await second;
      expect(done.status).toBe(200);
      expect((await done.json()).answer).toContain("PROMPT=two");
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });
});
