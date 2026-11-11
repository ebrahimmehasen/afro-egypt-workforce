import crypto from "node:crypto";

// A form the assistant has filled in for the admin to look over. It is only a suggestion kept for a little while:
// the admin opens the page, sees the form already filled in and presses save (or not). The assistant never saves
// anything itself.

export type DraftKind = "leave" | "overtime" | "deduction" | "work_request";

export type DraftValues = Record<string, string | number | string[] | undefined>;

export interface FormDraft {
  kind: DraftKind;
  values: DraftValues;
}

/** The page each form lives on. */
export const DRAFT_PAGES: Record<DraftKind, string> = {
  leave: "/leaves",
  overtime: "/overtime",
  deduction: "/deductions",
  work_request: "/requests",
};

const TTL_MS = 30 * 60_000;
const MAX_PER_USER = 20;

interface Stored extends FormDraft {
  uid: string;
  expires: number;
}

// Per-process, kept on globalThis because Next builds modules into more than one bundle.
const globalRef = globalThis as typeof globalThis & { __afroDrafts?: Map<string, Stored> };
const drafts = (globalRef.__afroDrafts ??= new Map());

function sweep(now: number) {
  for (const [id, d] of drafts) if (d.expires <= now) drafts.delete(id);
}

/** Keeps a draft for one user and returns the id that opens it (long and random; only that user can read it). */
export function saveDraft(uid: string, draft: FormDraft, now = Date.now()): string {
  sweep(now);
  const mine = [...drafts.entries()].filter(([, d]) => d.uid === uid);
  for (const [id] of mine.slice(0, Math.max(0, mine.length - (MAX_PER_USER - 1)))) drafts.delete(id);
  const id = crypto.randomBytes(16).toString("base64url");
  drafts.set(id, { ...draft, uid, expires: now + TTL_MS });
  return id;
}

/** The draft, if it is this user's and has not run out. */
export function readDraft(uid: string, id: string, now = Date.now()): FormDraft | null {
  const d = drafts.get(id);
  if (!d || d.uid !== uid || d.expires <= now) return null;
  return { kind: d.kind, values: d.values };
}
