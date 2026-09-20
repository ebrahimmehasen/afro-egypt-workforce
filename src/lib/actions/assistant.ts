"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { canUseAssistant } from "@/lib/permissions";
import { scopedSnapshot, viewerScope } from "@/lib/scope";
import { today } from "@/lib/today";
import { AssistantError } from "@/lib/assistant/nvidia";
import { runAssistant } from "@/lib/assistant/run";
import { takeSlot } from "@/lib/assistant/rate-limit";

export interface AssistantMessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

const MAX_QUESTION_CHARS = 2000;
const HISTORY_SHOWN = 60;
const HISTORY_SENT_TO_MODEL = 20;
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 5 * 60_000;

// Per-process state, kept on globalThis because Next builds this module into more than one bundle.
const globalRef = globalThis as typeof globalThis & {
  __afroAssistant?: { hits: Map<string, number[]>; busy: Set<string> };
};
const state = (globalRef.__afroAssistant ??= { hits: new Map(), busy: new Set() });

const toDTO = (m: { id: string; role: string; content: string; createdAt: Date }): AssistantMessageDTO => ({
  id: m.id,
  role: m.role === "assistant" ? "assistant" : "user",
  content: m.content,
  createdAt: m.createdAt.toISOString(),
});

async function authorised() {
  const user = await getSession();
  return user && canUseAssistant(user) ? user : null;
}

export async function loadAssistantHistory(): Promise<{ messages: AssistantMessageDTO[] } | { error: string }> {
  const t = await getT();
  const user = await authorised();
  if (!user) return { error: t.assistant.notAllowed };

  const rows = await prisma.assistantMessage.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_SHOWN,
  });
  return { messages: rows.reverse().map(toDTO) };
}

export async function clearAssistantHistory(): Promise<{ success: true } | { error: string }> {
  const t = await getT();
  const user = await authorised();
  if (!user) return { error: t.assistant.notAllowed };
  await prisma.assistantMessage.deleteMany({ where: { userId: user.id } });
  return { success: true };
}

function friendlyError(e: unknown, t: Awaited<ReturnType<typeof getT>>): string {
  if (e instanceof AssistantError) {
    if (e.code === "not_configured" || e.code === "auth") return t.assistant.errorNotConfigured;
    if (e.code === "rate_limited") return t.assistant.errorRateLimited;
    if (e.code === "timeout") return t.assistant.errorTimeout;
  }
  return t.assistant.errorGeneric;
}

export async function sendAssistantMessage(
  text: string,
): Promise<{ messages: AssistantMessageDTO[] } | { error: string }> {
  const t = await getT();
  const user = await authorised();
  if (!user) return { error: t.assistant.notAllowed };

  const question = String(text ?? "").trim();
  if (!question) return { error: t.assistant.errorGeneric };
  if (question.length > MAX_QUESTION_CHARS) return { error: t.assistant.errorTooLong };
  if (state.busy.has(user.id)) return { error: t.assistant.errorBusy };
  if (!takeSlot(state.hits, user.id, Date.now(), RATE_LIMIT, RATE_WINDOW_MS)) return { error: t.assistant.errorRateLimited };

  state.busy.add(user.id);
  const askedAt = new Date();
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

    // The model works on exactly what this user is allowed to see, never on the whole database.
    const scoped = scopedSnapshot(viewerScope(user, db.employees), db);

    let run;
    try {
      run = await runAssistant({
        question,
        history: saved.reverse().map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
        ctx: { db: scoped, t, locale, today: today() },
        userName: user.name,
      });
    } catch (e) {
      console.error("[assistant] failed:", e instanceof AssistantError ? `${e.code}: ${e.message}` : e);
      return { error: friendlyError(e, t) };
    }

    const [userRow, assistantRow] = await prisma.$transaction([
      prisma.assistantMessage.create({ data: { userId: user.id, role: "user", content: question, createdAt: askedAt } }),
      prisma.assistantMessage.create({ data: { userId: user.id, role: "assistant", content: run.answer } }),
    ]);

    // Who asked what, and which lookups it triggered — the answer itself is in the saved conversation.
    await prisma.auditLogEntry.create({
      data: {
        userName: user.name,
        module: t.nav.employees,
        action: t.assistant.auditAsk,
        oldValue: "-",
        newValue: question.slice(0, 300),
        reason: run.toolsUsed.length ? run.toolsUsed.join(", ") : null,
      },
    });

    return { messages: [toDTO(userRow), toDTO(assistantRow)] };
  } finally {
    state.busy.delete(user.id);
  }
}
