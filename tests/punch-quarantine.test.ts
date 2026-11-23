import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { RawLogsTable } from "@/components/attendance/raw-logs-table";
import {
  QUARANTINE_KEY,
  findDuplicateLineage,
  isQuarantined,
  markedPayload,
  quarantineOf,
  withoutQuarantined,
  type LineageRow,
} from "@/lib/punch-quarantine";

/**
 * Copies of a corrected punch (one hour after it, left by an hour-shift correction) are marked, never deleted:
 * calculations leave them out, the importer still counts them as taken, and the raw views list them labelled.
 * The first half is pure; the second runs the real code against the sample-seeded test database (skipped anywhere
 * else — the tests never use the production database, see tests/setup/db-guard.ts), with the device mocked.
 */
const device = vi.hoisted(() => ({ logs: [] as { deviceUserId: string; recordTime: Date }[] }));
vi.mock("@/lib/zk-device", () => ({
  fetchDeviceAttendanceLogs: async () => device.logs,
  syncDeviceClock: async () => ({ driftSeconds: 0, corrected: false }),
}));

const HOUR = 3_600_000;
const iso = (d: Date) => d.toISOString();

// ---------------------------------------------------------------------------------------------------------- pure

const row = (id: string, employeeId: string, at: string, over: Partial<LineageRow> = {}): LineageRow => ({
  id,
  employeeId,
  timestamp: new Date(at),
  source: "biometric",
  rawPayload: null,
  ...over,
});
/** A corrected punch: now at `at`, moved back from an hour later. */
const twin = (id: string, employeeId: string, at: string): LineageRow =>
  row(id, employeeId, at, { rawPayload: { timestampCorrectedFrom: iso(new Date(new Date(at).getTime() + HOUR)) } });

describe("the marker", () => {
  const pair = { duplicateId: "c1", twinId: "t1", correctionStamp: "2026-11-10T06:51:17.000Z" };

  it("is written beside whatever the row already held, and read back", () => {
    const marked = markedPayload({ deviceTime: "x" }, pair, new Date("2026-11-23T08:00:00.000Z"));
    expect(marked).toEqual({
      deviceTime: "x",
      [QUARANTINE_KEY]: { twinId: "t1", correctionStamp: "2026-11-10T06:51:17.000Z", markedAt: "2026-11-23T08:00:00.000Z" },
    });
    expect(quarantineOf(marked)).toEqual({ twinId: "t1", correctionStamp: "2026-11-10T06:51:17.000Z", markedAt: "2026-11-23T08:00:00.000Z" });
    expect(markedPayload(null, pair, new Date(0))[QUARANTINE_KEY]).toBeTruthy();
  });

  it("is only recognised when it is complete; an ordinary payload is not quarantined", () => {
    for (const p of [null, undefined, {}, [], "x", { deviceTime: "x" }, { [QUARANTINE_KEY]: {} }, { [QUARANTINE_KEY]: { twinId: "t" } }, { [QUARANTINE_KEY]: "yes" }]) {
      expect(isQuarantined(p)).toBe(false);
    }
    expect(isQuarantined({ [QUARANTINE_KEY]: { twinId: "t", correctionStamp: "s" } })).toBe(true);
  });

  it("withoutQuarantined drops only the marked rows and keeps the order", () => {
    const rows = [
      { id: "a", rawPayload: null },
      { id: "b", rawPayload: { [QUARANTINE_KEY]: { twinId: "t", correctionStamp: "s" } } },
      { id: "c", rawPayload: { timestampCorrectedFrom: "x" } },
    ];
    expect(withoutQuarantined(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("which rows are copies of a corrected punch", () => {
  it("finds the one row an hour after a corrected punch that holds the stamp it was moved from", () => {
    const rows = [twin("t1", "e1", "2026-11-10T05:51:17.000Z"), row("c1", "e1", "2026-11-10T06:51:17.000Z")];
    expect(findDuplicateLineage(rows)).toEqual({
      pairs: [{ duplicateId: "c1", twinId: "t1", correctionStamp: "2026-11-10T06:51:17.000Z" }],
      ambiguous: [],
    });
  });

  it("leaves everything else alone: a punch an hour after an uncorrected one, another employee's, a manual one, a near miss", () => {
    const rows = [
      twin("t1", "e1", "2026-11-10T05:51:17.000Z"),
      row("c1", "e1", "2026-11-10T06:51:17.000Z"), // the copy
      row("u1", "e1", "2026-11-10T08:00:00.000Z"), // ordinary punches an hour apart
      row("u2", "e1", "2026-11-10T09:00:00.000Z"),
      row("other", "e2", "2026-11-10T06:51:17.000Z"), // same stamp, another employee
      twin("t3", "e3", "2026-11-11T05:00:00.000Z"),
      row("manual", "e3", "2026-11-11T06:00:00.000Z", { source: "manual_correction" }),
      twin("t4", "e4", "2026-11-12T05:00:00.000Z"),
      row("near", "e4", "2026-11-12T06:00:01.000Z"), // a second off
    ];
    const { pairs, ambiguous } = findDuplicateLineage(rows);
    expect(pairs.map((p) => p.duplicateId)).toEqual(["c1"]);
    expect(ambiguous).toEqual([]);
  });

  it("does not re-mark a marked row, or take a corrected punch for a copy", () => {
    const marked = row("c1", "e1", "2026-11-10T06:51:17.000Z", { rawPayload: { [QUARANTINE_KEY]: { twinId: "t1", correctionStamp: "s" } } });
    expect(findDuplicateLineage([twin("t1", "e1", "2026-11-10T05:51:17.000Z"), marked]).pairs).toEqual([]);
    // two corrected punches an hour apart: the later one is a corrected punch, not a copy
    const chain = [twin("t1", "e1", "2026-11-10T05:00:00.000Z"), twin("t2", "e1", "2026-11-10T06:00:00.000Z")];
    expect(findDuplicateLineage(chain).pairs).toEqual([]);
  });

  it("reports, and does not guess, when a twin has two candidates or a copy has two twins", () => {
    const two = [twin("t1", "e1", "2026-11-10T05:00:00.000Z"), row("c1", "e1", "2026-11-10T06:00:00.000Z"), row("c2", "e1", "2026-11-10T06:00:00.000Z")];
    const a = findDuplicateLineage(two);
    expect(a.pairs).toEqual([]);
    expect(a.ambiguous).toEqual([{ twinId: "t1", candidateIds: ["c1", "c2"] }]);

    const shared = [twin("t1", "e1", "2026-11-10T05:00:00.000Z"), twin("t2", "e1", "2026-11-10T05:00:00.000Z"), row("c1", "e1", "2026-11-10T06:00:00.000Z")];
    const b = findDuplicateLineage(shared);
    expect(b.pairs).toEqual([]);
    expect(b.ambiguous.map((x) => x.twinId).sort()).toEqual(["t1", "t2"]);
  });

  it("ignores a correction stamp that is not an exact ISO time", () => {
    const bad = row("t1", "e1", "2026-11-10T05:00:00.000Z", { rawPayload: { timestampCorrectedFrom: "2026-11-10 06:00:00" } });
    expect(findDuplicateLineage([bad, row("c1", "e1", "2026-11-10T06:00:00.000Z")]).pairs).toEqual([]);
  });
});

// ----------------------------------------------------------------------------------------- with the test database

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}

const EMP = "ZZ-QRT-001";
const OTHER = "ZZ-QRT-002";
const THIRD = "ZZ-QRT-003";
const DEVICE_USER = "ZZQRT1";

async function cleanUp() {
  for (const id of [EMP, OTHER, THIRD]) {
    await prisma.deduction.deleteMany({ where: { employeeId: id } });
    await prisma.overtime.deleteMany({ where: { employeeId: id } }); // the job posts overtime for the day too
    await prisma.attendanceLog.deleteMany({ where: { employeeId: id } });
    await prisma.dailyAttendance.deleteMany({ where: { employeeId: id } });
  }
  await prisma.employee.deleteMany({ where: { id: { in: [EMP, OTHER, THIRD] } } });
}

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("quarantined copies against the real calculations", () => {
  let date = "";
  let realIn = new Date(0);
  let realOut = new Date(0);
  const ids = { twinIn: "", twinOut: "", copyIn: "", copyOut: "" };

  const day = () => new Date(`${date}T00:00:00.000Z`);
  const daily = () => prisma.dailyAttendance.findFirstOrThrow({ where: { employeeId: EMP, date: day() } });
  const exits = () => prisma.deduction.findMany({ where: { employeeId: EMP, date: day(), type: { in: ["unauthorized_exit", "permission_overrun"] }, voidedAt: null } });
  const setMarkers = async (on: boolean) => {
    const rows = [
      { id: ids.copyIn, twin: ids.twinIn, stamp: iso(new Date(realIn.getTime() + HOUR)) },
      { id: ids.copyOut, twin: ids.twinOut, stamp: iso(new Date(realOut.getTime() + HOUR)) },
    ];
    for (const r of rows) {
      await prisma.attendanceLog.update({
        where: { id: r.id },
        data: { rawPayload: on ? markedPayload(null, { duplicateId: r.id, twinId: r.twin, correctionStamp: r.stamp }, new Date()) : (null as never) },
      });
    }
  };

  beforeAll(async () => {
    await cleanUp();
    const { effectiveShift, loadPayContext } = await import("@/lib/pay-context");
    const { getShiftWindow } = await import("@/lib/attendance-engine");
    const seed = await prisma.employee.findFirstOrThrow({ where: { deletedAt: null, id: { startsWith: "EMP-" } }, orderBy: { id: "asc" } });
    const base = {
      jobTitle: "x", hireDate: new Date("2024-01-01"), departmentId: seed.departmentId, shiftId: seed.shiftId, basicSalary: 6000,
    };
    await prisma.employee.create({ data: { id: EMP, employeeNumber: "ZZQRT-001", name: "اختبار البصمات المعزولة", biometricDeviceUserId: DEVICE_USER, ...base } });
    await prisma.employee.create({ data: { id: OTHER, employeeNumber: "ZZQRT-002", name: "موظف آخر", ...base } });
    await prisma.employee.create({ data: { id: THIRD, employeeNumber: "ZZQRT-003", name: "موظف ثالث", ...base } });

    // a recent working day (Monday to Wednesday: never the weekly day off) and its real shift
    for (let back = 3; back <= 12; back++) {
      const d = new Date(Date.now() - back * 24 * HOUR);
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 3) {
        date = d.toISOString().slice(0, 10);
        break;
      }
    }
    const ctx = await loadPayContext();
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: EMP } });
    const { scheduledStart, scheduledEnd } = getShiftWindow(date, effectiveShift(ctx, employee as never, date));
    realIn = new Date(scheduledStart.getTime() - 10 * 60_000);
    realOut = new Date(scheduledEnd.getTime() + 5 * 60_000);

    const make = async (timestamp: Date, punchType: "in" | "out", rawPayload?: object) =>
      (await prisma.attendanceLog.create({ data: { employeeId: EMP, timestamp, punchType, source: "biometric", ...(rawPayload ? { rawPayload } : {}) } })).id;
    // the corrected punches (moved back an hour) and the copies an hour after them
    ids.twinIn = await make(realIn, "in", { timestampCorrectedFrom: iso(new Date(realIn.getTime() + HOUR)) });
    ids.twinOut = await make(realOut, "out", { timestampCorrectedFrom: iso(new Date(realOut.getTime() + HOUR)) });
    ids.copyIn = await make(new Date(realIn.getTime() + HOUR), "out");
    ids.copyOut = await make(new Date(realOut.getTime() + HOUR), "out");
    // the same stamps for another employee, which are nobody's copies
    await prisma.attendanceLog.create({ data: { employeeId: OTHER, timestamp: new Date(realIn.getTime() + HOUR), punchType: "in", source: "biometric" } });
  });

  it("(b) the lineage rule, run over the real rows, picks exactly the two copies", async () => {
    const rows = await prisma.attendanceLog.findMany({ where: { employeeId: { in: [EMP, OTHER] } }, select: { id: true, employeeId: true, timestamp: true, source: true, rawPayload: true } });
    const { pairs, ambiguous } = findDuplicateLineage(rows);
    expect(ambiguous).toEqual([]);
    expect(pairs.map((p) => [p.duplicateId, p.twinId]).sort()).toEqual(
      [[ids.copyIn, ids.twinIn], [ids.copyOut, ids.twinOut]].sort(),
    );
  });

  it("(a) without the marker the copies count: the day is read as an hour longer with an exit in the middle", async () => {
    const { recalculateDailyAttendance } = await import("@/lib/attendance-service");
    const { postAttendanceDeductions } = await import("@/lib/attendance-deductions");
    await recalculateDailyAttendance(EMP, date);
    expect((await daily()).actualOut?.getTime()).toBe(realOut.getTime() + HOUR);
    await postAttendanceDeductions();
    expect((await exits()).length).toBeGreaterThan(0);
  });

  it("(a) marked, the same punches give the real day and no exit deduction; the earlier exit entry is taken off", async () => {
    const { recalculateDailyAttendance } = await import("@/lib/attendance-service");
    const { postAttendanceDeductions } = await import("@/lib/attendance-deductions");
    await setMarkers(true);
    await recalculateDailyAttendance(EMP, date);
    const d = await daily();
    expect(d.actualIn?.getTime()).toBe(realIn.getTime());
    expect(d.actualOut?.getTime()).toBe(realOut.getTime());
    await postAttendanceDeductions();
    expect(await exits()).toEqual([]);
  });

  it("(a) the deduction job pairs only real punches: two quarantined rows in the middle of the day make no exit", async () => {
    const { recalculateDailyAttendance } = await import("@/lib/attendance-service");
    const { postAttendanceDeductions } = await import("@/lib/attendance-deductions");
    const at = (hoursAfterIn: number) => new Date(realIn.getTime() + hoursAfterIn * HOUR);
    const mark = (n: number) => markedPayload(null, { duplicateId: "x" + n, twinId: "y" + n, correctionStamp: iso(at(n)) }, new Date());
    const make = (timestamp: Date, punchType: "in" | "out", rawPayload?: object) =>
      prisma.attendanceLog.create({ data: { employeeId: THIRD, timestamp, punchType, source: "biometric", ...(rawPayload ? { rawPayload } : {}) } });
    await make(realIn, "in");
    const m1 = await make(at(2), "out", mark(2));
    const m2 = await make(at(3), "out", mark(3));
    await make(realOut, "out");
    const exitsOfThird = () => prisma.deduction.findMany({ where: { employeeId: THIRD, date: day(), type: { in: ["unauthorized_exit", "permission_overrun"] }, voidedAt: null } });

    await recalculateDailyAttendance(THIRD, date);
    await postAttendanceDeductions();
    expect(await exitsOfThird()).toEqual([]); // marked: nothing to pair

    // control: the same two rows unmarked are a real exit of an hour
    for (const m of [m1, m2]) await prisma.attendanceLog.update({ where: { id: m.id }, data: { rawPayload: null as never } });
    await postAttendanceDeductions();
    expect((await exitsOfThird()).length).toBeGreaterThan(0);

    // marked again: the job takes the entry off, the same way it does when a day is corrected
    for (const [m, n] of [[m1, 2], [m2, 3]] as const) await prisma.attendanceLog.update({ where: { id: m.id }, data: { rawPayload: mark(n) } });
    await postAttendanceDeductions();
    expect(await exitsOfThird()).toEqual([]);
  });

  it("(c) the importer still treats a quarantined copy as already taken, so a catch-up imports nothing", async () => {
    const { ingestOneRecord } = await import("@/lib/attendance-ingest");
    const { syncDeviceAttendanceWithClock } = await import("@/lib/attendance-sync");
    const before = await prisma.attendanceLog.count({ where: { employeeId: EMP } });
    const stamps = [new Date(realIn.getTime() + HOUR), new Date(realOut.getTime() + HOUR)];
    for (const s of stamps) expect(await ingestOneRecord(DEVICE_USER, s)).toEqual({ imported: false, reason: "duplicate" });
    device.logs = stamps.map((recordTime) => ({ deviceUserId: DEVICE_USER, recordTime }));
    const r = await syncDeviceAttendanceWithClock();
    expect(r.imported).toBe(0);
    expect(r.skippedDuplicate).toBe(2);
    expect(await prisma.attendanceLog.count({ where: { employeeId: EMP } })).toBe(before);
    // marking changed neither a time nor a source
    const copy = await prisma.attendanceLog.findUniqueOrThrow({ where: { id: ids.copyOut } });
    expect(copy.timestamp.getTime()).toBe(realOut.getTime() + HOUR);
    expect(copy.source).toBe("biometric");
  });

  it("(c) a punch pressed now is labelled in or out by the real punches only", async () => {
    const { ingestOneRecord } = await import("@/lib/attendance-ingest");
    // a new employee-day with nothing but a quarantined copy before it: the first real punch is still an "in"
    const at = new Date(realIn.getTime() + 24 * HOUR);
    await prisma.attendanceLog.create({
      data: { employeeId: OTHER, timestamp: new Date(at.getTime() - 5 * 60_000), punchType: "in", source: "biometric", rawPayload: markedPayload(null, { duplicateId: "x", twinId: "y", correctionStamp: "z" }, new Date()) },
    });
    await prisma.employee.update({ where: { id: OTHER }, data: { biometricDeviceUserId: "ZZQRT2" } });
    expect(await ingestOneRecord("ZZQRT2", at)).toEqual({ imported: true });
    const row = await prisma.attendanceLog.findFirstOrThrow({ where: { employeeId: OTHER, timestamp: at } });
    expect(row.punchType).toBe("in");
  });

  it("(d) the raw view still lists the copies, marked, and labels them", async () => {
    const { getAttendanceLogsForDate } = await import("@/lib/data");
    const logs = await getAttendanceLogsForDate(date, [EMP]);
    expect(logs).toHaveLength(4);
    const quarantined = logs.filter((l) => l.quarantined);
    expect(quarantined.map((l) => l.id).sort()).toEqual([ids.copyIn, ids.copyOut].sort());
    expect(quarantined.map((l) => l.quarantined!.twinId).sort()).toEqual([ids.twinIn, ids.twinOut].sort());

    // LocaleProvider is a plain function component, so it is called directly to keep its children typed
    const view = (rows: typeof logs) => renderToStaticMarkup(LocaleProvider({ locale: "ar", dictionary: ar, children: createElement(RawLogsTable, { logs: rows, employees: [] }) }));
    const html = view(logs);
    expect(html.split(ar.attendance.quarantinedPunch).length - 1).toBe(2);
    // and an ordinary row is not labelled
    expect(view(logs.filter((l) => !l.quarantined))).not.toContain(ar.attendance.quarantinedPunch);
  });
});
