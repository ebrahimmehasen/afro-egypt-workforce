import { takeSlot } from "@/lib/assistant/rate-limit";
import { RECRUITMENT_LIMITS as L } from "@/lib/recruitment/config";

// In memory, no paid service. It resets when the app restarts, which is acceptable for a spam brake (the honeypot and the
// size and type checks do the rest); a per-address limit plus a global one, so many spoofed addresses still hit a ceiling.
const perIp = new Map<string, number[]>();
const global = new Map<string, number[]>();

/** The visitor's address: Cloudflare's header when the request came through it, otherwise the first forwarded address. */
export function clientIp(headers: Pick<Headers, "get">): string {
  return headers.get("cf-connecting-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** True when this address may submit now (and the attempt is counted). */
export function allowSubmission(ip: string, now: number = Date.now()): boolean {
  if (!takeSlot(global, "all", now, L.globalLimit, L.globalWindowMs)) return false;
  return takeSlot(perIp, ip, now, L.perIpLimit, L.perIpWindowMs);
}

/** Tests only. */
export function resetSubmissionLimits() {
  perIp.clear();
  global.clear();
}
