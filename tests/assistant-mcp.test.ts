import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The tool server is spoken to the way the Claude CLI speaks to it: one JSON message per line on stdin and stdout.
const SCRIPT = path.join(process.cwd(), "assistant-bridge", "mcp-afro.mjs");
const TOKEN = "per-question-token";

let app: http.Server;
let appUrl: string;
let dir: string;
let logFile: string;
let child: ChildProcessWithoutNullStreams;
let lines: readline.Interface;
const pending = new Map<number, (m: Record<string, unknown>) => void>();
const seenAuth: (string | undefined)[] = [];
let nextId = 1;
let heard = 0;

function start(env: Record<string, string>): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
}

function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 5_000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  logFile = path.join(dir, "tools.log");

  app = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seenAuth.push(req.headers.authorization);
      const body = JSON.parse(raw || "{}");
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (body.op === "list") return send(200, { tools: [{ name: "attendance_summary", description: "x", inputSchema: { type: "object" } }] });
      if (body.name === "down") return send(500, { error: "the app is down" });
      if (body.name === "boom") return send(200, { result: '{"error":"boom"}', isError: true });
      return send(200, { result: JSON.stringify({ echoed: body.args }) });
    });
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/assistant/tool`;

  child = start({ AFRO_TOOL_URL: appUrl, AFRO_TOOL_TOKEN: TOKEN, AFRO_TOOL_LOG: logFile });
  lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    heard += 1;
    const m = JSON.parse(line) as Record<string, unknown>;
    pending.get(m.id as number)?.(m);
  });
});

afterAll(async () => {
  child.kill();
  await new Promise((resolve) => app.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the tool server", () => {
  it("introduces itself with the protocol version the client asked for", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(r.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "afro" } });
  });

  it("says nothing in answer to a notification", async () => {
    const before = heard;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const ping = await rpc("ping");
    expect(ping.result).toEqual({});
    expect(heard - before).toBe(1);
  });

  it("lists the app's tools, asking the app with this question's token", async () => {
    const r = await rpc("tools/list");
    expect((r.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(["attendance_summary"]);
    expect(seenAuth.at(-1)).toBe(`Bearer ${TOKEN}`);
  });

  it("calls a tool through the app and notes its name for the audit trail", async () => {
    const r = await rpc("tools/call", { name: "attendance_summary", arguments: { date: "2026-09-19" } });
    expect(r.result).toMatchObject({ isError: false, content: [{ type: "text" }] });
    const text = ((r.result as { content: { text: string }[] }).content[0]).text;
    expect(JSON.parse(text)).toEqual({ echoed: { date: "2026-09-19" } });
    expect(fs.readFileSync(logFile, "utf8")).toContain("attendance_summary");
  });

  it("passes a tool's own error on as an error the model can read", async () => {
    const r = await rpc("tools/call", { name: "boom", arguments: {} });
    expect(r.result).toMatchObject({ isError: true });
  });

  it("turns a failure to reach the app into a tool error, not a broken connection", async () => {
    const r = await rpc("tools/call", { name: "down", arguments: {} });
    expect(r.error).toBeUndefined();
    expect(r.result).toMatchObject({ isError: true });
    expect(JSON.stringify(r.result)).toContain("the app is down");
  });

  it("refuses a method it doesn't have", async () => {
    const r = await rpc("resources/list");
    expect(r.error).toMatchObject({ code: -32601 });
  });

  it("won't start without an address and a token", async () => {
    const lone = start({ AFRO_TOOL_URL: "", AFRO_TOOL_TOKEN: "" });
    const code = await new Promise<number | null>((resolve) => lone.on("close", resolve));
    expect(code).toBe(1);
  });
});
