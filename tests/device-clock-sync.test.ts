import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The fingerprint device stamped punches with its own clock, which kept going an hour out. A live punch now takes
 * the moment it reached the server, and the 10-minute catch-up — which reads the device's whole log again, under
 * the device's stamps — neither imports it a second time nor keeps a wrong stamp for a punch it pulls itself.
 * Runs the real ingestion against the sample-seeded dev database, with the device itself mocked; skipped anywhere
 * else.
 */
const device = vi.hoisted(() => ({ logs: [] as { deviceUserId: string; recordTime: Date }[], driftSeconds: 0 }));
vi.mock("@/lib/zk-device", () => ({
  fetchDeviceAttendanceLogs: async () => device.logs,
  // the real one sets the device right; the test sets the next reading itself
  syncDeviceClock: async () => ({ driftSeconds: device.driftSeconds, corrected: device.driftSeconds !== 0 }),
}));

const { ingestOneRecord } = await import("@/lib/attendance-ingest");
const { syncDeviceAttendanceWithClock } = await import("@/lib/attendance-sync");
const { trueRealtimeTime } = await import("@/lib/device-clock");

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}

const EMP = "ZZ-CLK-001";
const DEVICE_ID = "ZZCLK1";
const hours = (n: number) => n * 3_600_000;
const logs = () => prisma.attendanceLog.findMany({ where: { employeeId: EMP }, orderBy: { timestamp: "asc" } });

async function cleanUp() {
  await prisma.attendanceLog.deleteMany({ where: { employeeId: EMP } });
  await prisma.dailyAttendance.deleteMany({ where: { employeeId: EMP } });
  await prisma.employee.deleteMany({ where: { id: EMP } });
}

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("punches from a device whose clock is an hour out", () => {
  beforeAll(async () => {
    await cleanUp();
    const seed = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } });
    await prisma.employee.create({
      data: { id: EMP, employeeNumber: "ZZCLK-001", name: "اختبار ساعة البصمة", departmentId: seed.departmentId, jobTitle: "x", hireDate: new Date("2024-01-01"), shiftId: seed.shiftId, basicSalary: 6000, biometricDeviceUserId: DEVICE_ID },
    });
  });

  it("a live punch is stored at the moment it arrived, with the device's stamp kept beside it", async () => {
    const received = new Date(Date.now() - hours(2));
    const stamped = new Date(received.getTime() + hours(1)); // device an hour ahead
    const at = trueRealtimeTime(stamped, received);
    expect(await ingestOneRecord(DEVICE_ID, at, stamped)).toEqual({ imported: true });
    const [row] = await logs();
    expect(row.timestamp.getTime()).toBe(received.getTime());
    expect(row.rawPayload).toEqual({ deviceTime: stamped.toISOString() });
  });

  it("the catch-up reading the device's log again doesn't import it a second time under the wrong stamp", async () => {
    const [live] = await logs();
    const stamp = new Date((live.rawPayload as { deviceTime: string }).deviceTime);
    device.logs = [{ deviceUserId: DEVICE_ID, recordTime: stamp }];
    device.driftSeconds = 0; // put right since
    const r = await syncDeviceAttendanceWithClock();
    expect(r.imported).toBe(0);
    expect(r.skippedDuplicate).toBe(1);
    expect(await logs()).toHaveLength(1);
  });

  it("a punch the listener missed is pulled with the device's error taken off", async () => {
    // the clock was right at the last check (the test above); after it, it went an hour ahead and this punch came
    const really = new Date(Date.now() + 1000);
    const stamped = new Date(really.getTime() + hours(1));
    device.logs = [{ deviceUserId: DEVICE_ID, recordTime: stamped }];
    device.driftSeconds = 3600;
    const r = await syncDeviceAttendanceWithClock();
    expect(r).toMatchObject({ imported: 1, corrected: 1, clockDriftSeconds: 3600 });
    const rows = await logs();
    expect(rows).toHaveLength(2);
    expect(rows[1].timestamp.getTime()).toBe(really.getTime());
    // and pulled again with the clock right, it is recognised by its device stamp
    device.driftSeconds = 0;
    expect((await syncDeviceAttendanceWithClock()).imported).toBe(0);
    expect(await logs()).toHaveLength(2);
  });

  it("a punch stamped while the clock was right is taken as it is, and still recognised the old way", async () => {
    const stamped = new Date(Date.now() - hours(5));
    device.logs = [{ deviceUserId: DEVICE_ID, recordTime: stamped }];
    device.driftSeconds = 0;
    expect((await syncDeviceAttendanceWithClock()).imported).toBe(1);
    const row = (await logs()).find((l) => l.timestamp.getTime() === stamped.getTime())!;
    expect(row.rawPayload).toBeNull();
    expect(await ingestOneRecord(DEVICE_ID, stamped)).toEqual({ imported: false, reason: "duplicate" });
  });
});
