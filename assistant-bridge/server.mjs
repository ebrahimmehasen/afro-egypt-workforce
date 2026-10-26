#!/usr/bin/env node
// The assistant service: a small local HTTP server that answers one question at a time per request by running
// the Claude CLI under the Claude account signed in on this machine. It keeps nothing between questions: every
// question gets its own process, its own temporary folder and its own tool token, and no session is saved, so
// two admins asking at once can never see each other's conversation.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIMITS, buildCliArgs, buildMcpConfig, buildPrompt, buildSystemPrompt, parseCliResult, validateAsk } from "./bridge-core.mjs";

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

/** Runs the CLI with the prompt on stdin. Resolves with what it printed; a hung run is killed. */
function runCli(config, args, prompt, env) {
  return new Promise((resolve) => {
    const child = spawn(config.cli, [...config.cliArgsPrefix, ...args], { cwd: config.workDir, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, config.timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}${e.message}`, code: -1, timedOut, spawnFailed: true });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut, spawnFailed: false });
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
        const entry = { go: () => resolve(release), timer: setTimeout(() => {
          queue.splice(queue.indexOf(entry), 1);
          resolve(null);
        }, waitMs) };
        queue.push(entry);
      });
    },
  };
}

export function createBridge(config) {
  const gate = makeGate(config.maxParallel, config.queueWaitMs);

  async function ask(body) {
    const instructions = readInstructions(config);
    const systemPrompt = buildSystemPrompt({ instructions, context: body.context });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afro-assistant-"));
    try {
      const logFile = path.join(dir, "tools.log");
      const mcpConfigPath = path.join(dir, "mcp.json");
      fs.writeFileSync(mcpConfigPath, JSON.stringify(buildMcpConfig({ nodePath: process.execPath, mcpScript: config.mcpScript, toolUrl: body.toolUrl, toolToken: body.toolToken, logFile })));

      const env = { ...process.env, DISABLE_AUTOUPDATER: "1" };
      delete env.ASSISTANT_BRIDGE_SECRET;
      if (config.configDir) env.CLAUDE_CONFIG_DIR = config.configDir;

      const args = buildCliArgs({ systemPrompt, mcpConfigPath, model: config.model, budgetUsd: config.budgetUsd });
      const run = await runCli(config, args, buildPrompt(body), env);
      if (run.timedOut) return { ok: false, code: "timeout", message: `The assistant did not answer within ${config.timeoutMs / 1000}s.` };
      if (run.spawnFailed) return { ok: false, code: "unavailable", message: `The Claude CLI could not be started: ${run.stderr.slice(0, 200)}` };

      const parsed = parseCliResult(run.stdout, run.stderr);
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

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return reply(res, 200, { ok: true, running: gate.running });
      if (req.method !== "POST" || req.url !== "/ask") return reply(res, 404, { ok: false, code: "bad_request", message: "Not found." });
      if (!sameSecret(req.headers["x-bridge-secret"], config.secret)) return reply(res, 401, { ok: false, code: "auth", message: "Wrong secret." });

      let body;
      try {
        body = JSON.parse(await readBody(req, LIMITS.body));
      } catch {
        return fail(res, "bad_request", "The body is not valid JSON, or is too large.");
      }
      const checked = validateAsk(body);
      if (!checked.ok) return fail(res, "bad_request", checked.message);

      const release = await gate.acquire();
      if (!release) return fail(res, "busy", "The assistant is busy answering other questions. Try again in a moment.");
      const startedAt = Date.now();
      let outcome;
      try {
        outcome = await ask(checked.value);
      } finally {
        release();
      }
      // only sizes and outcomes are logged, never what was asked or answered
      console.log(`${new Date().toISOString()} ask ok=${outcome.ok} ${outcome.ok ? `tools=${outcome.toolsUsed.length} cost=${outcome.costUsd ?? "-"}` : `code=${outcome.code}`} ms=${Date.now() - startedAt}`);
      if (!outcome.ok) return fail(res, outcome.code, outcome.message);
      return reply(res, 200, { ok: true, answer: outcome.answer, toolsUsed: outcome.toolsUsed });
    } catch (e) {
      console.error(`${new Date().toISOString()} error ${e instanceof Error ? e.message : e}`);
      if (!res.headersSent) reply(res, 500, { ok: false, code: "unavailable", message: "The assistant service failed." });
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
