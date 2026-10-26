// Per-process state, kept on globalThis because Next builds modules into more than one bundle.
const globalRef = globalThis as typeof globalThis & {
  __afroAssistant?: { hits: Map<string, number[]>; busy: Set<string> };
};

export const assistantState = (globalRef.__afroAssistant ??= { hits: new Map(), busy: new Set() });

export const MAX_QUESTION_CHARS = 2000;
export const HISTORY_SHOWN = 60;
export const HISTORY_SENT_TO_MODEL = 20;
export const RATE_LIMIT = 15;
export const RATE_WINDOW_MS = 5 * 60_000;
