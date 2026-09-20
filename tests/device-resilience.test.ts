import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATUS_GRACE_MS, createBoundedCache, createMutex, realtimeStatus, reconnectDelay } from "@/lib/device-resilience";

const never = <T>() => new Promise<T>(() => {});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createMutex", () => {
  it("runs jobs one at a time, in order", async () => {
    const run = createMutex();
    const log: string[] = [];
    const a = deferred<void>();
    const p1 = run(async () => {
      log.push("a:start");
      await a.promise;
      log.push("a:end");
    });
    const p2 = run(async () => {
      log.push("b:start");
    });
    await Promise.resolve();
    expect(log).toEqual(["a:start"]); // b waits for a
    a.resolve();
    await Promise.all([p1, p2]);
    expect(log).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("keeps going after a job throws", async () => {
    const run = createMutex();
    const failing = run(async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(run(async () => "next")).resolves.toBe("next");
  });

  it("returns each job's own result", async () => {
    const run = createMutex();
    expect(await Promise.all([run(async () => 1), run(async () => 2)])).toEqual([1, 2]);
  });
});

describe("reconnectDelay", () => {
  it("backs off then holds at 30s", () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
  });
});

describe("createBoundedCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads on the first call and serves fresh data without loading again", async () => {
    const load = vi.fn(async () => "data");
    const cache = createBoundedCache(load, { freshMs: 30_000 });
    expect(await cache.get(5000)).toMatchObject({ ok: true, value: "data", stale: false });
    expect(await cache.get(5000)).toMatchObject({ ok: true, value: "data", stale: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads once the data is no longer fresh", async () => {
    let t = 1_000;
    const load = vi.fn(async () => `v${load.mock.calls.length}`);
    const cache = createBoundedCache(load, { freshMs: 30_000, now: () => t });
    expect(await cache.get(5000)).toMatchObject({ value: "v1" });
    t += 31_000;
    expect(await cache.get(5000)).toMatchObject({ value: "v2", stale: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives up waiting instead of hanging when the device never answers", async () => {
    const cache = createBoundedCache(() => never<string>(), { freshMs: 30_000 });
    const pending = cache.get(8000);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toEqual({ ok: false, error: "timed out waiting for the device" });
  });

  it("falls back to the last good data, flagged stale, when a refresh times out", async () => {
    let t = 0;
    let slow = false;
    const load = vi.fn(() => (slow ? never<string>() : Promise.resolve("old")));
    const cache = createBoundedCache(load, { freshMs: 30_000, now: () => t });
    await cache.get(5000);
    slow = true;
    t += 60_000;
    const pending = cache.get(8000);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ ok: true, value: "old", stale: true, fetchedAt: 0 });
  });

  it("falls back to stale data when the device errors, and reports the error when there is none", async () => {
    let t = 0;
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error("connect ETIMEDOUT");
      return "old";
    });
    const cache = createBoundedCache(load, { freshMs: 1_000, now: () => t });
    expect(await cache.get(5000)).toMatchObject({ ok: true, value: "old" });
    fail = true;
    t += 5_000;
    expect(await cache.get(5000)).toMatchObject({ ok: true, value: "old", stale: true });

    const cold = createBoundedCache(async () => {
      throw new Error("connect ETIMEDOUT");
    }, { freshMs: 1_000 });
    expect(await cold.get(5000)).toEqual({ ok: false, error: "connect ETIMEDOUT" });
  });

  it("shares one load between concurrent callers", async () => {
    const d = deferred<string>();
    const load = vi.fn(() => d.promise);
    const cache = createBoundedCache(load, { freshMs: 30_000 });
    const a = cache.get(5000);
    const b = cache.get(5000);
    d.resolve("shared");
    expect(await a).toMatchObject({ value: "shared" });
    expect(await b).toMatchObject({ value: "shared" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("invalidate() forces a reload but keeps the old data as a fallback", async () => {
    let n = 0;
    const load = vi.fn(async () => `v${++n}`);
    const cache = createBoundedCache(load, { freshMs: 30_000 });
    await cache.get(5000);
    cache.invalidate();
    expect(await cache.get(5000)).toMatchObject({ value: "v2", stale: false });
  });

  it("does not let a load that started before invalidate() repopulate the cache", async () => {
    const before = deferred<string>();
    const loads = [before.promise, Promise.resolve("after-write")];
    const load = vi.fn(() => loads.shift()!);
    const cache = createBoundedCache(load, { freshMs: 30_000 });

    const inFlight = cache.get(5000); // starts the pre-write load
    cache.invalidate(); // a write happens meanwhile
    before.resolve("before-write");
    await inFlight;

    // the pre-write result must not be served as fresh
    expect(await cache.get(5000)).toMatchObject({ value: "after-write", stale: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("recovers on the next call after a failed load", async () => {
    let ok = false;
    const load = vi.fn(async () => {
      if (!ok) throw new Error("down");
      return "back";
    });
    const cache = createBoundedCache(load, { freshMs: 30_000 });
    expect(await cache.get(5000)).toMatchObject({ ok: false });
    ok = true;
    expect(await cache.get(5000)).toMatchObject({ ok: true, value: "back" });
  });
});

describe("realtimeStatus", () => {
  const base = { active: false, userPaused: false, opsRunning: 0, downSince: 1_000, failedAttempts: 0, now: 1_000 };

  it("is connected while the socket is open", () => {
    expect(realtimeStatus({ ...base, active: true })).toBe("connected");
  });

  it("reports a manual pause as paused, whatever else is going on", () => {
    expect(realtimeStatus({ ...base, userPaused: true, failedAttempts: 3 })).toBe("paused");
  });

  it("stays connected while one of our own device operations has the listener switched off", () => {
    // e.g. the page reading the device: takes as long as the punch log is big, nothing is wrong
    expect(realtimeStatus({ ...base, opsRunning: 1, now: 1_000 + 5 * STATUS_GRACE_MS })).toBe("connected");
  });

  it("stays connected during the short window right after it goes down", () => {
    expect(realtimeStatus({ ...base, now: 1_000 + STATUS_GRACE_MS - 1 })).toBe("connected");
  });

  it("turns to reconnecting once it has been down past the grace period", () => {
    expect(realtimeStatus({ ...base, now: 1_000 + STATUS_GRACE_MS })).toBe("reconnecting");
  });

  it("turns to reconnecting immediately when a reconnect attempt has failed", () => {
    expect(realtimeStatus({ ...base, failedAttempts: 1 })).toBe("reconnecting");
    expect(realtimeStatus({ ...base, failedAttempts: 1, opsRunning: 1 })).toBe("reconnecting");
  });

  it("reads as reconnecting if it was never started", () => {
    expect(realtimeStatus({ ...base, downSince: null })).toBe("reconnecting");
  });
});
