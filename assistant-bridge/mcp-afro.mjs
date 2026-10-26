// The assistant's tools, as an MCP server over stdio. The Claude CLI starts it for one question. It holds no data
// and no logic of its own: the list of tools and every call go to the app (AFRO_TOOL_URL) with this question's
// short-lived token, so the app decides what is allowed and what comes back.

import fs from "node:fs";
import readline from "node:readline";

const URL_ = process.env.AFRO_TOOL_URL;
const TOKEN = process.env.AFRO_TOOL_TOKEN;
const LOG = process.env.AFRO_TOOL_LOG;
const PROTOCOL = "2025-06-18";
const CALL_TIMEOUT_MS = 60_000;

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function callApp(payload) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `The app answered HTTP ${res.status}`);
  return json;
}

function remember(name) {
  if (!LOG) return;
  try {
    fs.appendFileSync(LOG, `${name}\n`);
  } catch {
    // the log is only for the audit trail; a failure to write it must not break the answer
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const hasId = id !== undefined && id !== null;
  const ok = (result) => hasId && send({ jsonrpc: "2.0", id, result });
  const error = (code, message) => hasId && send({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({ protocolVersion: params?.protocolVersion ?? PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "afro", version: "1.0.0" } });
    case "ping":
      return ok({});
    case "tools/list":
      try {
        return ok({ tools: (await callApp({ op: "list" })).tools ?? [] });
      } catch (e) {
        return error(-32603, e instanceof Error ? e.message : "The tools could not be listed.");
      }
    case "tools/call": {
      const name = params?.name;
      remember(name);
      try {
        const out = await callApp({ op: "call", name, args: params?.arguments ?? {} });
        return ok({ content: [{ type: "text", text: String(out.result ?? "") }], isError: Boolean(out.isError) });
      } catch (e) {
        // a failed tool is an answer the model can read and work around, not a broken connection
        return ok({ content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : "The tool failed." }) }], isError: true });
      }
    }
    default:
      // notifications (no id) are ignored; an unknown request gets an error
      return hasId ? error(-32601, `Method not found: ${method}`) : undefined;
  }
}

if (!URL_ || !TOKEN) {
  process.stderr.write("AFRO_TOOL_URL and AFRO_TOOL_TOKEN are required.\n");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  void handle(msg);
});
rl.on("close", () => process.exit(0));
