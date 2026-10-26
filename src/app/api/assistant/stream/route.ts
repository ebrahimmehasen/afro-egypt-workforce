import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { canUseAssistant } from "@/lib/permissions";
import { scopedSnapshot, viewerScope } from "@/lib/scope";
import { today } from "@/lib/today";
import { AssistantError } from "@/lib/assistant/errors";
import { streamClaude } from "@/lib/assistant/claude-bridge";
import { toDTO } from "@/lib/assistant/dto";
import { buildSnapshot } from "@/lib/assistant/employee-tools";
import { takeSlot } from "@/lib/assistant/rate-limit";
import { HISTORY_SENT_TO_MODEL, MAX_QUESTION_CHARS, RATE_LIMIT, RATE_WINDOW_MS, assistantState } from "@/lib/assistant/state";
import { createAnswerStream } from "@/lib/assistant/stream";
import { signToolToken } from "@/lib/assistant/tool-token";

// The answer, written live: the browser reads one JSON event per line while the assistant is still typing.
// Admin only, checked here on every request (the middleware leaves /api alone).
export const dynamic = "force-dynamic";

type Dict = Awaited<ReturnType<typeof getT>>;

function friendlyError(e: unknown, t: Dict): string {
  if (e instanceof AssistantError) {
    if (e.code === "not_configured" || e.code === "auth") return t.assistant.errorNotConfigured;
    if (e.code === "rate_limited") return t.assistant.errorRateLimited;
    if (e.code === "timeout") return t.assistant.errorTimeout;
    if (e.code === "busy") return t.assistant.errorBusy;
  }
  return t.assistant.errorGeneric;
}

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const t = await getT();
  const user = await getSession();
  if (!user || !canUseAssistant(user)) return refuse(t.assistant.notAllowed, 403);

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const question = typeof body?.text === "string" ? body.text.trim() : "";
  if (!question) return refuse(t.assistant.errorGeneric, 400);
  if (question.length > MAX_QUESTION_CHARS) return refuse(t.assistant.errorTooLong, 400);

  const { busy, hits } = assistantState;
  if (busy.has(user.id)) return refuse(t.assistant.errorBusy, 429);
  if (!takeSlot(hits, user.id, Date.now(), RATE_LIMIT, RATE_WINDOW_MS)) return refuse(t.assistant.errorRateLimited, 429);

  busy.add(user.id);
  const askedAt = new Date();
  let setup;
  try {
    const [db, locale, saved] = await Promise.all([
      getDb(),
      getLocale(),
      prisma.assistantMessage.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: HISTORY_SENT_TO_MODEL,
      }),
    ]);
    // The figures handed to the model cover exactly what this user is allowed to see.
    const day = today();
    const scoped = scopedSnapshot(viewerScope(user, db.employees), db);
    setup = {
      history: saved.reverse().map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
      context: { userName: user.name, today: day, locale, snapshot: JSON.parse(buildSnapshot({ db: scoped, t, locale, today: day })) },
      toolToken: signToolToken({ uid: user.id, loc: locale }),
    };
  } catch (e) {
    busy.delete(user.id);
    console.error("[assistant] setup failed:", e);
    return refuse(t.assistant.errorGeneric, 500);
  }

  const stream = createAnswerStream({
    events: (signal) => streamClaude({ question, ...setup, signal }),
    save: async (answer, toolsUsed) => {
      const [userRow, assistantRow] = await prisma.$transaction([
        prisma.assistantMessage.create({ data: { userId: user.id, role: "user", content: question, createdAt: askedAt } }),
        prisma.assistantMessage.create({ data: { userId: user.id, role: "assistant", content: answer } }),
      ]);
      // Who asked what, and which lookups it triggered — the answer itself is in the saved conversation.
      await prisma.auditLogEntry.create({
        data: {
          userName: user.name,
          module: t.assistant.title,
          action: t.assistant.auditAsk,
          oldValue: "-",
          newValue: question.slice(0, 300),
          reason: toolsUsed.length ? toolsUsed.join(", ") : null,
        },
      });
      return [toDTO(userRow), toDTO(assistantRow)];
    },
    describeError: (e) => {
      console.error("[assistant] failed:", e instanceof AssistantError ? `${e.code}: ${e.message}` : e);
      return friendlyError(e, t);
    },
    finish: () => busy.delete(user.id),
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
