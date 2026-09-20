import { afterEach, describe, expect, it, vi } from "vitest";

// Every Prisma write tells each open tab "data changed" and the tab refreshes its page. Reading the
// device's saved connection used to be an upsert, so rendering the device page — and every device
// operation — counted as a write and re-rendered the page in a loop. It has to be a plain read.
const db = vi.hoisted(() => ({
  row: null as null | { id: string; ip: string; port: number; commPassword: number },
  calls: [] as string[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    biometricDeviceSettings: {
      findUnique: async () => {
        db.calls.push("findUnique");
        return db.row;
      },
      create: async ({ data }: { data: NonNullable<typeof db.row> }) => {
        db.calls.push("create");
        db.row = data;
        return data;
      },
      upsert: async () => {
        db.calls.push("upsert");
        return db.row;
      },
      update: async () => {
        db.calls.push("update");
        return db.row;
      },
    },
  },
}));

import { getDeviceConnection } from "@/lib/zk-device";

afterEach(() => {
  db.row = null;
  db.calls.length = 0;
});

describe("getDeviceConnection", () => {
  it("only reads when the settings already exist", async () => {
    db.row = { id: "singleton", ip: "192.168.1.50", port: 4370, commPassword: 7 };
    for (let i = 0; i < 3; i++) {
      expect(await getDeviceConnection()).toEqual({ ip: "192.168.1.50", port: 4370, commPassword: 7 });
    }
    expect(db.calls).toEqual(["findUnique", "findUnique", "findUnique"]);
  });

  it("creates the default row once, the first time", async () => {
    const first = await getDeviceConnection();
    expect(first).toEqual({ ip: "192.168.1.201", port: 4370, commPassword: 0 });
    await getDeviceConnection();
    expect(db.calls).toEqual(["findUnique", "create", "findUnique"]);
  });
});
