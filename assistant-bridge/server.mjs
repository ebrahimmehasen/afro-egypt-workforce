// The assistant service: a small local HTTP server that answers questions by running the Claude CLI under the
// Claude account signed in on this machine. It keeps nothing between questions: every question gets its own
// process, its own temporary folder and its own tool token, and no session is saved, so two admins asking at once
// can never see each other's conversation.
//
//   POST /ask-stream  the answer as it is written: one JSON event per line (delta, tool, done, error)
//   POST /ask         the same question, answered once it is complete
//   GET  /health

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIMITS, buildCliArgs, buildMcpConfig, buildPrompt, buildSystemPrompt, parseCliResult, readStreamLine, validateAsk } from "./bridge-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function configFromEnv(env = process.env) {
  return {
    port: Number(env.ASSISTANT_BRIDGE_PORT) || 4100,
    secret: env.ASSISTANT_BRIDGE_SECRET,
    cli: env.ASSISTANT_CLI,
    cliArgsPrefix: [],
    configDir: env.ASSISTANT_CLAUDE_CONFIG_DIR,
    workDir: env.ASSISTANT_WORKDIR || path.join(here, "workspace"),
    instructionsFile: env.ASSISTANT_INSTRUCTIONS || path.join(here, "INSTRUCTIONS.md"),
    defaultInstructionsFile: path.join(here, "INSTRUCTIONS.md"),
    mcpScript: path.join(here, "mcp-afro.mjs"),
    model: env.ASSISTANT_MODEL || "sonnet",
    budgetUsd: env.ASSISTANT_BUDGET_USD || "1.00",
    timeoutMs: Number(env.ASSISTANT_TIMEOUT_MS) || 150_000,
    maxParallel: Number(env.ASSISTANT_MAX_PARALLEL) || 3,
    queueWaitMs: Number(env.ASSISTANT_QUEUE_WAIT_MS) || 60_000,
  };
}

const STATUS = { bad_request: 400, auth: 503, rate_limited: 429, busy: 429, timeout: 504, unavailable: 502, bad_response: 502 };

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

const fail = (res, code, message) => reply(res, STATUS[code] ?? 500, { ok: false, code, message });

function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("The request is too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGKILL");
}

/**
 * Runs the CLI with the prompt on stdin and hands every line it prints to `onLine` as it arrives. A run that hangs
 * is killed after the time limit, and so is one nobody is waiting for any more (`signal`).
 */
function streamCli(config, args, prompt, env, { onLine, signal }) {
  return new Promise((resolve) => {
    const child = spawn(config.cli, [...config.cliArgsPrefix, ...args], { cwd: config.workDir, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let pending = "";
    let tail = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const stop = () => {
      aborted = true;
      killTree(child);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, config.timeoutMs);
    if (signal) {
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      // what the CLI prints when it can't even start is plain text; the end of the output is kept to read that
      tail = (tail + chunk).slice(-4000);
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i).trim();
        pending = pending.slice(i + 1);
        if (line) onLine(line);
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ tail, stderr: `${stderr}${e.message}`, timedOut, aborted, spawnFailed: true });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const rest = pending.trim();
      pending = "";
      if (rest) onLine(rest);
      resolve({ tail, stderr, timedOut, aborted, spawnFailed: false });
    });
    child.stdin.end(prompt);
  });
}

function readInstructions(config) {
  for (const file of [config.instructionsFile, config.defaultInstructionsFile]) {
    try {
      const text = fs.readFileSync(file, "utf8");
      if (text.trim()) return text;
    } catch {
      // try the next one
    }
  }
  throw new Error("No instructions file could be read.");
}

/** At most `limit` questions run at once; the rest wait a little for a turn instead of failing at once. */
function makeGate(limit, waitMs) {
  let running = 0;
  const queue = [];
  const release = () => {
    running -= 1;
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      running += 1;
      next.go();
    }
  };
  return {
    get running() {
      return running;
    },
    acquire() {
      if (running < limit) {
        running += 1;
        return Promise.resolve(release);
      }
      return new Promise((resolve) => {
        const entry = {
          go: () => resolve(release),
          timer: setTimeout(() => {
            queue.splice(queue.indexOf(entry), 1);
            resolve(null);
          }, waitMs),
        };
        queue.push(entry);
      });
    },
  };
}

/** Asks the CLI one question. `onEvent` hears each piece of the answer as it is written; the outcome is final. */
async function runQuestion(config, body, { onEvent, signal }) {
  const systemPrompt = buildSystemPrompt({ instructions: readInstructions(config), context: body.context });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afro-assistant-"));
  try {
    const logFile = path.join(dir, "tools.log");
    const mcpConfigPath = path.join(dir, "mcp.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify(buildMcpConfig({ nodePath: process.execPath, mcpScript: config.mcpScript, toolUrl: body.toolUrl, toolToken: body.toolToken, logFile })));

    const env = { ...process.env, DISABLE_AUTOUPDATER: "1" };
    delete env.ASSISTANT_BRIDGE_SECRET;
    if (config.configDir) env.CLAUDE_CONFIG_DIR = config.configDir;

    let result = null;
    const onLine = (line) => {
      const event = readStreamLine(line);
      if (!event) return;
      if (event.type === "result") result = event.parsed;
      else onEvent(event);
    };

    const args = buildCliArgs({ systemPrompt, mcpConfigPath, model: config.model, budgetUsd: config.budgetUsd });
    const run = await streamCli(config, args, buildPrompt(body), env, { onLine, signal });
    if (run.aborted) return { ok: false, code: "aborted", message: "Nobody was waiting for the answer any more." };
    if (run.timedOut) return { ok: false, code: "timeout", message: `The assistant did not answer within ${config.timeoutMs / 1000}s.` };
    if (run.spawnFailed) return { ok: false, code: "unavailable", message: `The Claude CLI could not be started: ${run.stderr.slice(0, 200)}` };

    const parsed = result ?? parseCliResult(run.tail, run.stderr);
    if (!parsed.ok) return parsed;
    let toolsUsed = [];
    try {
      toolsUsed = [...new Set(fs.readFileSync(logFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean))];
    } catch {
      // no tool was called
    }
    return { ok: true, answer: parsed.answer, toolsUsed, costUsd: parsed.costUsd };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function createBridge(config) {
  const gate = makeGate(config.maxParallel, config.queueWaitMs);

  async function handleAsk(req, res, streaming) {
    if (!sameSecret(req.headers["x-bridge-secret"], config.secret)) return reply(res, 401, { ok: false, code: "auth", message: "Wrong secret." });

    let body;
    try {
      body = JSON.parse(await readBody(req, LIMITS.body));
    } catch {
      return fail(res, "bad_request", "The body is not valid JSON, or is too large.");
    }
    const checked = validateAsk(body);
    if (!checked.ok) return fail(res, "bad_request", checked.message);

    // whoever asked going away (a closed tab, a stop button) stops the CLI instead of letting it run on
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) gone.abort();
    });

    const release = await gate.acquire();
    if (!release) return fail(res, "busy", "The assistant is busy answering other questions. Try again in a moment.");

    const send = (obj) => {
      if (streaming && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(obj)}\n`);
    };
    if (streaming) res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });

    const startedAt = Date.now();
    let outcome;
    try {
      outcome = gone.signal.aborted
        ? { ok: false, code: "aborted", message: "Nobody was waiting for the answer any more." }
        : await runQuestion(config, checked.value, { onEvent: send, signal: gone.signal });
    } catch (e) {
      console.error(`${new Date().toISOString()} error ${e instanceof Error ? e.message : e}`);
      outcome = { ok: false, code: "unavailable", message: "The assistant service failed." };
    } finally {
      release();
    }
    // only sizes and outcomes are logged, never what was asked or answered
    console.log(`${new Date().toISOString()} ask ok=${outcome.ok} ${outcome.ok ? `tools=${outcome.toolsUsed.length} cost=${outcome.costUsd ?? "-"}` : `code=${outcome.code}`} ms=${Date.now() - startedAt}`);

    if (streaming) {
      send(outcome.ok ? { type: "done", answer: outcome.answer, toolsUsed: outcome.toolsUsed } : { type: "error", code: outcome.code, message: outcome.message });
      return res.end();
    }
    if (res.destroyed) return undefined;
    if (!outcome.ok) return fail(res, outcome.code, outcome.message);
    return reply(res, 200, { ok: true, answer: outcome.answer, toolsUsed: outcome.toolsUsed });
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return reply(res, 200, { ok: true, running: gate.running });
      if (req.method === "POST" && req.url === "/ask") return await handleAsk(req, res, false);
      if (req.method === "POST" && req.url === "/ask-stream") return await handleAsk(req, res, true);
      return reply(res, 404, { ok: false, code: "bad_request", message: "Not found." });
    } catch (e) {
      console.error(`${new Date().toISOString()} error ${e instanceof Error ? e.message : e}`);
      if (!res.headersSent) reply(res, 500, { ok: false, code: "unavailable", message: "The assistant service failed." });
      else res.end();
    }
  });
}

// Started directly (not imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configFromEnv();
  const missing = [["ASSISTANT_BRIDGE_SECRET", config.secret], ["ASSISTANT_CLI", config.cli], ["ASSISTANT_CLAUDE_CONFIG_DIR", config.configDir]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing settings: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!fs.existsSync(config.cli)) {
    console.error(`The Claude CLI was not found at ${config.cli}`);
    process.exit(1);
  }
  fs.mkdirSync(config.workDir, { recursive: true });
  fs.mkdirSync(config.configDir, { recursive: true });
  createBridge(config).listen(config.port, "127.0.0.1", () => {
    console.log(`${new Date().toISOString()} assistant service listening on 127.0.0.1:${config.port} (model ${config.model}, up to ${config.maxParallel} at once)`);
  });
}
