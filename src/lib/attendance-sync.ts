import { fetchDeviceAttendanceLogs, syncDeviceClock } from "@/lib/zk-device";
import { ingestOneRecord } from "@/lib/attendance-ingest";
import { needsClockSync, trueLoggedTime } from "@/lib/device-clock";
import { prisma } from "@/lib/prisma";

export interface AttendanceSyncResult {
  imported: number;
  skippedUnlinked: number;
  skippedDuplicate: number;
  unlinkedDeviceUserIds: string[];
  /** Punches whose device stamp was put right because the device clock was off. */
  corrected: number;
}

/**
 * Pulls every punch sitting in the device's log buffer and writes the ones
 * we haven't seen yet into AttendanceLog. This is the "pull" counterpart to
 * /api/punch's "push" ingestion — /api/punch only ever receives anything if
 * the device itself is configured to call it (ADMS/cloud push), which
 * nothing in this project sets up. It's also the catch-up mechanism used
 * around the real-time listener (attendance-realtime.ts): whenever that
 * listener is paused or reconnecting, this fills in whatever it missed.
 *
 * Safe to call repeatedly / concurrently with the real-time path —
 * ingestOneRecord dedupes on (employeeId, timestamp).
 */
export async function syncDeviceAttendance(
  clock: { driftSeconds: number; clockRightSince: Date | null } = { driftSeconds: 0, clockRightSince: null },
): Promise<AttendanceSyncResult> {
  const rawLogs = await fetchDeviceAttendanceLogs();
  rawLogs.sort((a, b) => a.recordTime.getTime() - b.recordTime.getTime());

  let imported = 0;
  let skippedDuplicate = 0;
  let corrected = 0;
  const unlinkedDeviceUserIds = new Set<string>();

  for (const log of rawLogs) {
    const at = trueLoggedTime(log.recordTime, clock.driftSeconds, clock.clockRightSince);
    const outcome = await ingestOneRecord(log.deviceUserId, at, log.recordTime);
    if (outcome.imported) {
      imported++;
      if (at.getTime() !== log.recordTime.getTime()) corrected++;
    } else if (outcome.reason === "unlinked") unlinkedDeviceUserIds.add(log.deviceUserId);
    else if (outcome.reason === "duplicate") skippedDuplicate++;
  }

  return {
    imported,
    skippedUnlinked: unlinkedDeviceUserIds.size,
    skippedDuplicate,
    unlinkedDeviceUserIds: [...unlinkedDeviceUserIds],
    corrected,
  };
}

// When the device clock was last found right, for the whole process (this module is bundled more than once).
const clockState = ((globalThis as typeof globalThis & { __afroDeviceClock?: { rightAt: Date | null } }).__afroDeviceClock ??= {
  rightAt: null,
});

/**
 * The sync the catch-up and the "sync now" button run: first the device clock is read and, if it is off, set
 * right (syncDeviceClock); then the log is pulled, and the punches stamped since the clock was last known right
 * have the error it was found with taken off. Right after a restart that moment isn't known yet, so the newest
 * punch already on file stands in for it. The clock check failing (an old device without the command, say)
 * never stops the sync: the stamps are then taken as they are, as before.
 */
export async function syncDeviceAttendanceWithClock(): Promise<AttendanceSyncResult & { clockDriftSeconds: number | null; clockCorrected: boolean }> {
  const checkedAt = new Date();
  let driftSeconds = 0;
  let clockDriftSeconds: number | null = null;
  let clockCorrected = false;
  try {
    const clock = await syncDeviceClock();
    clockDriftSeconds = clock.driftSeconds;
    clockCorrected = clock.corrected;
    if (needsClockSync(clock.driftSeconds)) {
      driftSeconds = clock.driftSeconds;
      console.warn(`[device-clock] the device clock was ${clock.driftSeconds}s off the server; ${clock.corrected ? "set it right" : "could not set it right"}`);
    }
  } catch (e) {
    console.error("[device-clock] could not check the device clock:", e instanceof Error ? e.message : e);
  }

  const clockRightSince =
    clockState.rightAt ??
    (await prisma.attendanceLog.findFirst({ where: { source: "biometric" }, orderBy: { timestamp: "desc" }, select: { timestamp: true } }))?.timestamp ??
    null;
  const result = await syncDeviceAttendance({ driftSeconds, clockRightSince });
  if (result.corrected > 0) console.warn(`[device-clock] ${result.corrected} punch(es) stamped by the wrong device clock were put right`);
  // from here on the device stamps right again (or always did)
  if (clockDriftSeconds !== null && (!needsClockSync(clockDriftSeconds) || clockCorrected)) clockState.rightAt = checkedAt;
  return { ...result, clockDriftSeconds, clockCorrected };
}

/**
 * Imports one device user's entire punch history — called right after
 * linkDeviceUserAction commits, so "link this person" means their whole
 * attendance record actually lands in the system immediately, not just
 * whatever punches happen to come in from now on.
 */
export async function backfillDeviceUser(deviceUserId: string): Promise<{ imported: number }> {
  const rawLogs = await fetchDeviceAttendanceLogs();
  const forThisUser = rawLogs
    .filter((r) => r.deviceUserId === deviceUserId)
    .sort((a, b) => a.recordTime.getTime() - b.recordTime.getTime());

  let imported = 0;
  for (const log of forThisUser) {
    const outcome = await ingestOneRecord(log.deviceUserId, log.recordTime);
    if (outcome.imported) imported++;
  }
  return { imported };
}
