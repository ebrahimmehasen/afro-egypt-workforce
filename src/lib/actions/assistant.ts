"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { canUseAssistant } from "@/lib/permissions";
import { toDTO, type AssistantMessageDTO } from "@/lib/assistant/dto";
import { HISTORY_SHOWN } from "@/lib/assistant/state";

// Asking a question is not here: answers stream in through /api/assistant/stream.

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
