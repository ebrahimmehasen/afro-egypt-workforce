import { CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";

// Server-only. Asks the assistant service (assistant-bridge/, the Claude CLI already running on this machine under its own
// sign-in) for a short DRAFT description, through its tool-less /describe-image (one photo) or /describe-images (the
// whole current set of a case) calls. The same secret and address as the assistant; no new service, no new credential.
// It NEVER throws and never invents text: when the service is not configured, is an older version without the call, is
// down, is slow, or answers nothing, the result says why and the supervisor gets an empty field to write in himself. The
// draft is given the department(s) and the uploader as context and NO employee name: it describes the photo(s), never who
// it is about. The text is only ever a draft, shown as such and always editable; it never overwrites a saved finalText.

export type DraftFailure = "not_configured" | "unavailable" | "timeout" | "auth" | "rate_limited" | "bad_response" | "busy";
export type DraftResult = { ok: true; text: string } | { ok: false; reason: DraftFailure };

const REASONS: DraftFailure[] = ["not_configured", "unavailable", "timeout", "auth", "rate_limited", "bad_response", "busy"];
const asReason = (v: unknown): DraftFailure => REASONS.find((r) => r === v) ?? "unavailable";

export interface DraftContext {
  department: string;
  uploader: string;
  locale: "ar" | "en";
}

const cut = (v: string) => v.replace(/\s+/g, " ").trim().slice(0, L.maxContextLength);

interface BridgeCallOpts {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Shared by requestCaseDraft and requestCaseSetDraft: same secret, same timeout/abort handling, same never-throws
 * contract and the same shape of answer. Only the route and the body differ between one photo and a set of them. */
async function callBridge(path: string, body: Record<string, unknown>, opts: BridgeCallOpts): Promise<DraftResult> {
  const env = opts.env ?? process.env;
  const secret = env.ASSISTANT_BRIDGE_SECRET;
  if (!secret) return { ok: false, reason: "not_configured" };
  const base = (env.ASSISTANT_BRIDGE_URL || "http://127.0.0.1:4100").replace(/\/+$/, "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? L.aiTimeoutMs);
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${base}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-bridge-secret": secret },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok?: unknown; answer?: unknown; code?: unknown } | null;
    // an older service has no such call: it answers 404, which is "unavailable", never a made-up description
    if (!res.ok || !json || json.ok !== true) return { ok: false, reason: asReason(json?.code) };
    const text = typeof json.answer === "string" ? json.answer.replace(/\s+\n/g, "\n").trim().slice(0, L.maxDraftLength) : "";
    return text ? { ok: true, text } : { ok: false, reason: "bad_response" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "AbortError" ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestCaseDraft(opts: {
  image: { mime: string; bytes: Uint8Array };
  context: DraftContext;
} & BridgeCallOpts): Promise<DraftResult> {
  return callBridge(
    "/describe-image",
    {
      image: { mediaType: opts.image.mime, data: Buffer.from(opts.image.bytes).toString("base64") },
      context: { locale: opts.context.locale, department: cut(opts.context.department), uploader: cut(opts.context.uploader) },
    },
    opts,
  );
}

/**
 * The combined draft for ALL of a case's current photos (never one per photo): asked right after the first upload, and
 * again after every photo is added or removed, so the AI always reads the FULL current set. Same never-throws contract
 * as requestCaseDraft, through the bridge's /describe-images call.
 */
export async function requestCaseSetDraft(opts: {
  images: { mime: string; bytes: Uint8Array }[];
  context: DraftContext;
} & BridgeCallOpts): Promise<DraftResult> {
  return callBridge(
    "/describe-images",
    {
      images: opts.images.map((i) => ({ mediaType: i.mime, data: Buffer.from(i.bytes).toString("base64") })),
      context: { locale: opts.context.locale, department: cut(opts.context.department), uploader: cut(opts.context.uploader) },
    },
    opts,
  );
}
