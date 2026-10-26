import type { Store } from "@/lib/store";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Role } from "@/lib/types";
import { canUseAssistant } from "@/lib/permissions";
import { listTools, runTool } from "@/lib/assistant/tools";
import type { AdminExtras } from "@/lib/assistant/admin-tools";
import { verifyToolToken } from "@/lib/assistant/tool-token";

// What the assistant's tool process talks to. Kept free of Next and Prisma so it can be tested with fakes; the
// route wires in the real ones.

/** A single tool result is cut to this many characters so one huge answer can't crowd out the rest. */
const MAX_RESULT_CHARS = 14_000;

export interface ToolEndpointDeps {
  loadUser(uid: string): Promise<{ role: Role; active: boolean } | null>;
  loadStore(): Promise<Store>;
  /** Requests, audit trail, accounts, holidays and devices: what the admin sees outside the main store. */
  loadExtras?(): Promise<AdminExtras>;
  dictionary(locale: "ar" | "en"): Dictionary;
  today(): string;
  now?: number;
}

export interface ToolEndpointReply {
  status: number;
  json: unknown;
}

export async function handleToolRequest(authorization: string | null, body: unknown, deps: ToolEndpointDeps): Promise<ToolEndpointReply> {
  const token = verifyToolToken(authorization?.replace(/^Bearer\s+/i, ""), deps.now);
  if (!token) return { status: 401, json: { error: "unauthorized" } };

  // The token only says who asked. Whether that person may still use the assistant is read from the database
  // every time, and today that is the admin alone, so what is handed out below is the whole store.
  const user = await deps.loadUser(token.uid);
  if (!user || !user.active || !canUseAssistant({ role: user.role, permissions: [] })) return { status: 403, json: { error: "forbidden" } };

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.op === "list") return { status: 200, json: { tools: listTools() } };

  if (b.op === "call" && typeof b.name === "string") {
    try {
      const [db, extras] = await Promise.all([deps.loadStore(), deps.loadExtras?.()]);
      const ctx = { db, extras, t: deps.dictionary(token.loc), locale: token.loc, today: deps.today() };
      const text = JSON.stringify(runTool(b.name, b.args, ctx));
      const result = text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… [truncated — ask a narrower question for the rest]` : text;
      return { status: 200, json: { result } };
    } catch (e) {
      return { status: 200, json: { result: JSON.stringify({ error: e instanceof Error ? e.message : "The tool failed." }), isError: true } };
    }
  }

  return { status: 400, json: { error: "bad request" } };
}
