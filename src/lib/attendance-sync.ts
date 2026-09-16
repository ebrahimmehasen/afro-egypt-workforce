import { fetchDeviceAttendanceLogs } from "@/lib/zk-device";
import { ingestOneRecord } from "@/lib/attendance-ingest";

export interface AttendanceSyncResult {
  imported: number;
  skippedUnlinked: number;
  skippedDuplicate: number;
  unlinkedDeviceUserIds: string[];
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
export async function syncDeviceAttendance(): Promise<AttendanceSyncResult> {
  const rawLogs = await fetchDeviceAttendanceLogs();
  rawLogs.sort((a, b) => a.recordTime.getTime() - b.recordTime.getTime());

  let imported = 0;
  let skippedDuplicate = 0;
  const unlinkedDeviceUserIds = new Set<string>();

  for (const log of rawLogs) {
    const outcome = await ingestOneRecord(log.deviceUserId, log.recordTime);
    if (outcome.imported) imported++;
    else if (outcome.reason === "unlinked") unlinkedDeviceUserIds.add(log.deviceUserId);
    else if (outcome.reason === "duplicate") skippedDuplicate++;
  }

  return {
    imported,
    skippedUnlinked: unlinkedDeviceUserIds.size,
    skippedDuplicate,
    unlinkedDeviceUserIds: [...unlinkedDeviceUserIds],
  };
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
