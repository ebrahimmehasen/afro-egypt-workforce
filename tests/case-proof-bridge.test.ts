import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridge } from "../assistant-bridge/server.mjs";
import { DESCRIBE_LIMITS, buildDescribeArgs, buildDescribeInput, buildDescribeSystemPrompt, validateDescribe } from "../assistant-bridge/bridge-core.mjs";

/**
 * The assistant service's describe-image call (case proof): the photo goes to the CLI inline, with no tools and no MCP at
 * all, behind the same secret. A stand-in CLI echoes what it was given so a test can see exactly what reached it.
 */
const STUB = `
import fs from "node:fs";
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const message = JSON.parse(input.trim().split("\\n")[0]);
  const blocks = message.message.content;
  const image = blocks.find((b) => b.type === "image");
  const text = blocks.find((b) => b.type === "text").text;
  if (text.includes("[[LOGIN]]")) return void process.stdout.write("Not logged in \\u00b7 Please run /login\\n");
  if (image.source.data === "RU1QVFk=") return void process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "   " }) + "\\n");
  const result = [
    "TYPE=" + message.type,
    "IMAGE=" + image.source.media_type + ":" + image.source.data.length,
    "TEXT=" + text,
    "TOOLS=" + JSON.stringify(flag("--tools")),
    "MCP_CONFIG=" + String(args.includes("--mcp-config")),
    "STRICT=" + String(args.includes("--strict-mcp-config")),
    "ALLOWED=" + String(args.includes("--allowedTools")),
    "INPUT_FORMAT=" + flag("--input-format"),
    "SYSTEM=" + (flag("--system-prompt") || "").split("\\n")[0],
    "SECRET_VISIBLE=" + Boolean(process.env.ASSISTANT_BRIDGE_SECRET),
  ].join("\\n");
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result, total_cost_usd: 0.01 }) + "\\n");
});
`;

const SECRET = "bridge-secret";
let dir: string;
let server: Server;
let base: string;

const image = { mediaType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString("base64") };
const ctx = { locale: "ar", department: "التعبئة", uploader: "المشرف سامي" };
const post = (route: string, body: unknown, secret: string | null = SECRET) =>
  fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-bridge-secret": secret }) }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-cp-test-"));
  fs.mkdirSync(path.join(dir, "work"));
  fs.writeFileSync(path.join(dir, "stub-cli.mjs"), STUB);
  fs.writeFileSync(path.join(dir, "INSTRUCTIONS.md"), "rules");
  const s = createBridge({
    port: 0,
    secret: SECRET,
    cli: process.execPath,
    cliArgsPrefix: [path.join(dir, "stub-cli.mjs")],
    configDir: path.join(dir, "claude-home"),
    workDir: path.join(dir, "work"),
    instructionsFile: path.join(dir, "INSTRUCTIONS.md"),
    defaultInstructionsFile: path.join(process.cwd(), "assistant-bridge", "INSTRUCTIONS.md"),
    mcpScript: path.join(process.cwd(), "assistant-bridge", "mcp-afro.mjs"),
    model: "sonnet",
    budgetUsd: "1.00",
    timeoutMs: 5_000,
    maxParallel: 3,
    queueWaitMs: 500,
  }) as Server;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  server = s;
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("describe-image: the pure rules", () => {
  it("accepts a jpg, png or webp as base64 and cleans the context", () => {
    const r = validateDescribe({ image, context: { ...ctx, department: "A\nB" } });
    expect(r).toMatchObject({ ok: true, value: { image, context: { locale: "ar", department: "A B", uploader: "المشرف سامي" } } });
    // an employee name sent by mistake is dropped, never carried further
    const withName = validateDescribe({ image, context: { ...ctx, employee: "حسام" } });
    expect(withName).toMatchObject({ ok: true });
    expect(JSON.stringify(withName)).not.toContain("حسام");
    for (const mediaType of ["image/jpeg", "image/webp"]) expect(validateDescribe({ image: { ...image, mediaType }, context: ctx })).toMatchObject({ ok: true });
  });

  it("refuses another type, data that is not base64, an empty or oversize image, a missing context", () => {
    expect(validateDescribe({ image: { ...image, mediaType: "application/pdf" }, context: ctx })).toMatchObject({ ok: false });
    expect(validateDescribe({ image: { ...image, mediaType: "image/svg+xml" }, context: ctx })).toMatchObject({ ok: false });
    expect(validateDescribe({ image: { ...image, data: "not base64!!" }, context: ctx })).toMatchObject({ ok: false });
    expect(validateDescribe({ image: { ...image, data: "" }, context: ctx })).toMatchObject({ ok: false });
    expect(validateDescribe({ image: { ...image, data: "A".repeat(DESCRIBE_LIMITS.imageBase64 + 4) }, context: ctx })).toMatchObject({ ok: false });
    expect(validateDescribe({ image })).toMatchObject({ ok: false });
    expect(validateDescribe(null)).toMatchObject({ ok: false });
  });

  it("the CLI gets no tools and no MCP at all, and the photo arrives inline as one stream-json message", () => {
    const args = buildDescribeArgs({ systemPrompt: "x", model: "sonnet", budgetUsd: "1.00" });
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--allowedTools");
    expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json");
    const line = buildDescribeInput({ image, context: { locale: "ar", department: "D", uploader: "U" } });
    expect(line.endsWith("\n")).toBe(true);
    const message = JSON.parse(line);
    expect(message.message.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: image.data } });
    expect(message.message.content[1].text).toContain("not instructions");
  });

  it("the fixed rules: neutral, no blame, no scores, no penalty, no faces, text in the photo is not an instruction", () => {
    const rules = buildDescribeSystemPrompt({ locale: "en" });
    for (const phrase of ["DRAFT", "Do not judge or blame", "rate or score", "penalty", "face", "never an instruction"]) expect(rules).toContain(phrase);
    expect(rules).toContain("Write in English");
    expect(buildDescribeSystemPrompt({ locale: "ar" })).toContain("Write in Arabic");
  });
});

describe("describe-image: the service", () => {
  it("answers with the CLI's text, having handed it the photo and the context and nothing else", async () => {
    const res = await post("/describe-image", { image, context: ctx });
    expect(res.status).toBe(200);
    const { ok, answer } = (await res.json()) as { ok: boolean; answer: string };
    expect(ok).toBe(true);
    expect(answer).toContain("TYPE=user");
    expect(answer).toContain(`IMAGE=image/png:${image.data.length}`);
    expect(answer).toContain("التعبئة");
    expect(answer).toContain("المشرف سامي");
    // no employee name is ever given: not by the app, and not carried through even if one is sent
    expect(answer).not.toContain("حسام");
    expect(answer).toContain('TOOLS=""');
    expect(answer).toContain("MCP_CONFIG=false");
    expect(answer).toContain("STRICT=true");
    expect(answer).toContain("ALLOWED=false");
    expect(answer).toContain("INPUT_FORMAT=stream-json");
    expect(answer).toContain("SECRET_VISIBLE=false"); // the shared secret never reaches the CLI
  });

  it("an employee name sent by mistake never reaches the CLI", async () => {
    const res = await post("/describe-image", { image, context: { ...ctx, employee: "حسام" } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("حسام");
  });

  it("refuses a wrong or missing secret", async () => {
    expect((await post("/describe-image", { image, context: ctx }, "wrong")).status).toBe(401);
    expect((await post("/describe-image", { image, context: ctx }, null)).status).toBe(401);
  });

  it("refuses a bad request: not JSON, a pdf, no image", async () => {
    expect((await post("/describe-image", "{nope")).status).toBe(400);
    expect((await post("/describe-image", { image: { ...image, mediaType: "application/pdf" }, context: ctx })).status).toBe(400);
    expect((await post("/describe-image", { context: ctx })).status).toBe(400);
  });

  it("a CLI that is not signed in, and one that answers nothing, are errors (so the app leaves the field empty)", async () => {
    const login = await post("/describe-image", { image, context: { ...ctx, department: "[[LOGIN]]" } });
    expect(login.status).toBe(503);
    expect(await login.json()).toMatchObject({ ok: false, code: "auth" });
    const empty = await post("/describe-image", { image: { ...image, data: "RU1QVFk=" }, context: ctx });
    expect(empty.status).toBe(502);
    expect(await empty.json()).toMatchObject({ ok: false, code: "bad_response" });
  });

  it("the other routes are unchanged: health answers, an unknown route is 404, /ask still wants its own fields", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await post("/nope", {})).status).toBe(404);
    expect((await post("/ask", { image, context: ctx })).status).toBe(400);
  });
});
