import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Runs the real node-zklib code against fake devices on localhost — no hardware, no database.
// This is the situation after a power cut: the device is either refusing connections or accepting
// them and then never answering. Neither may leave a page waiting.
const target = vi.hoisted(() => ({ port: 0 }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    biometricDeviceSettings: {
      upsert: async () => ({ ip: "127.0.0.1", port: target.port, commPassword: 0 }),
    },
  },
}));

import { getDeviceOverview, invalidateDeviceOverview } from "@/lib/zk-device";

const sockets = new Set<net.Socket>();
let silentServer: net.Server;
let silentPort = 0;
let closedPort = 0;

const listen = (server: net.Server) =>
  new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));

beforeAll(async () => {
  // accepts the connection and then says nothing — a device that is up but wedged / still booting
  silentServer = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => {});
    s.on("close", () => sockets.delete(s));
  });
  silentPort = await listen(silentServer);

  // grab a free port, then close it so nothing is listening there
  const probe = net.createServer();
  closedPort = await listen(probe);
  await new Promise((r) => probe.close(r));
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => silentServer.close(r));
});

describe("an unreachable fingerprint device never hangs the page", () => {
  it("reports offline quickly when nothing is listening", async () => {
    target.port = closedPort;
    invalidateDeviceOverview();
    const started = Date.now();
    const result = await getDeviceOverview(3000);
    expect(result.online).toBe(false);
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it("gives up after the wait limit when the device accepts but never answers", async () => {
    target.port = silentPort;
    invalidateDeviceOverview();
    const started = Date.now();
    const result = await getDeviceOverview(1200);
    const elapsed = Date.now() - started;
    expect(result.online).toBe(false);
    // the library's own timeouts are 4s (connect) / 8s (reply) — the page limit has to win
    expect(elapsed).toBeGreaterThanOrEqual(1100);
    expect(elapsed).toBeLessThan(2500);
  });

  it("answers a second visit at once instead of queueing behind the first", async () => {
    target.port = silentPort;
    // the previous call's read is still running in the background — a new caller shares it
    const started = Date.now();
    const result = await getDeviceOverview(800);
    expect(result.online).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
}, 20_000);
