import { afterEach, describe, expect, it, vi } from "vitest";

// Next.js compiles the device module into several bundles, each with its own copy of module-level
// variables. The listener state, the mutex and the overview cache must therefore not live in module
// scope: importing the module again (a fresh copy, as a second bundle would get) has to see the very
// same state. This is what made the status badge read "disconnected" a few seconds after loading.
vi.mock("@/lib/prisma", () => ({
  prisma: { biometricDeviceSettings: { upsert: async () => ({ ip: "127.0.0.1", port: 1, commPassword: 0 }) } },
}));

type Shared = { __afroZkShared?: unknown };
const shared = globalThis as unknown as Shared;

afterEach(() => {
  delete shared.__afroZkShared;
  vi.resetModules();
});

describe("device state is shared between module copies", () => {
  it("a pause made through one copy is seen by another", async () => {
    vi.resetModules();
    const a = await import("@/lib/zk-device");
    expect(a.isRealtimeListenerPaused()).toBe(false);
    await a.stopRealtimeListener({ userInitiated: true });
    expect(a.isRealtimeListenerPaused()).toBe(true);

    vi.resetModules(); // what a second bundle gets: a brand-new copy of the module
    const b = await import("@/lib/zk-device");
    expect(b).not.toBe(a);
    expect(b.isRealtimeListenerPaused()).toBe(true);
    expect(b.getRealtimeConnectionStatus()).toBe("paused");
  });

  it("uses one mutex and one cache across copies", async () => {
    vi.resetModules();
    await import("@/lib/zk-device");
    const first = shared.__afroZkShared as { runExclusive: unknown; overviewCache: unknown };

    vi.resetModules();
    await import("@/lib/zk-device");
    const second = shared.__afroZkShared as { runExclusive: unknown; overviewCache: unknown };

    expect(second).toBe(first);
    expect(second.runExclusive).toBe(first.runExclusive);
    expect(second.overviewCache).toBe(first.overviewCache);
  });
});
