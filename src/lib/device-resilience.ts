// Pure helpers that keep the fingerprint device from making the app hang. No I/O and no
// node-zklib import, so they run (and are tested) without the hardware.

/**
 * Runs async jobs one at a time, in order. The device accepts a single connection, so two
 * jobs overlapping (a page load, a sync, the listener reconnecting) just fight over it.
 * A job that throws doesn't block the ones queued behind it.
 */
export function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** How long to wait before the next reconnect try: 5s, 10s, 20s, then every 30s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 5_000 * 2 ** Math.max(0, attempt));
}

export type CachedResult<T> =
  | { ok: true; value: T; fetchedAt: number; stale: boolean }
  | { ok: false; error: string };

interface Entry<T> {
  value: T;
  fetchedAt: number;
  /** Set by invalidate(): still usable as a fallback, but never served as fresh. */
  outdated?: boolean;
}

/**
 * Wraps a slow, sometimes-unreachable read so callers wait a bounded time.
 *
 *  - fresh data (younger than `freshMs`) is returned straight away;
 *  - otherwise it loads, but waits at most `maxWaitMs`;
 *  - if that fails or runs out of time, the last good data comes back flagged `stale`
 *    (or an error if there has never been any) — the load keeps going in the background;
 *  - concurrent callers share one load;
 *  - `invalidate()` marks data outdated after a write, and a load already in flight from before
 *    it can't repopulate the cache with the old data.
 */
export function createBoundedCache<T>(
  load: () => Promise<T>,
  opts: { freshMs: number; now?: () => number },
) {
  const now = opts.now ?? Date.now;
  let entry: Entry<T> | null = null;
  let inflight: Promise<Entry<T>> | null = null;
  let generation = 0;

  function startLoad(): Promise<Entry<T>> {
    if (inflight) return inflight;
    const startedIn = generation;
    const p: Promise<Entry<T>> = load().then((value) => {
      const fresh = { value, fetchedAt: now() };
      if (startedIn === generation) entry = fresh;
      return fresh;
    });
    inflight = p;
    const clear = () => {
      if (inflight === p) inflight = null;
    };
    p.then(clear, clear); // also marks the promise handled if nobody is still waiting on it
    return p;
  }

  async function get(maxWaitMs: number): Promise<CachedResult<T>> {
    if (entry && !entry.outdated && now() - entry.fetchedAt < opts.freshMs) {
      return { ok: true, value: entry.value, fetchedAt: entry.fetchedAt, stale: false };
    }

    const loading = startLoad();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), maxWaitMs);
    });

    try {
      const outcome = await Promise.race([
        loading.then(
          (e) => ({ kind: "loaded" as const, e }),
          (error: unknown) => ({ kind: "failed" as const, error }),
        ),
        timedOut,
      ]);

      if (outcome !== "timeout" && outcome.kind === "loaded") {
        return { ok: true, value: outcome.e.value, fetchedAt: outcome.e.fetchedAt, stale: false };
      }
      if (entry) return { ok: true, value: entry.value, fetchedAt: entry.fetchedAt, stale: true };
      const error =
        outcome === "timeout"
          ? "timed out waiting for the device"
          : outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error);
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
    }
  }

  function invalidate() {
    generation += 1;
    inflight = null;
    if (entry) entry = { ...entry, outdated: true };
  }

  return { get, invalidate };
}
