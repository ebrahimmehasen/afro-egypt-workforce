/**
 * Sliding-window limiter: at most `limit` calls per `windowMs` for one key. The hosted model has its own
 * free-tier ceiling, so a runaway loop or a double-clicking user shouldn't be able to burn it.
 * Returns true when the call is allowed (and records it), false when the key is over its limit.
 */
export function takeSlot(hits: Map<string, number[]>, key: string, now: number, limit: number, windowMs: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
