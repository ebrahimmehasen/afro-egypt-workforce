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
