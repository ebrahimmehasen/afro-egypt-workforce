import { prisma } from "@/lib/prisma";
import { recalculateDailyAttendance } from "@/lib/attendance-service";
import { fetchDeviceAttendanceLogs } from "@/lib/zk-device";

export interface AttendanceSyncResult {
  imported: number;
  skippedUnlinked: number;
  skippedDuplicate: number;
  unlinkedDeviceUserIds: string[];
}

/**
 * Pulls every punch sitting in the device's log buffer and writes the ones
 * we haven't seen yet into AttendanceLog, then recomputes daily attendance
 * for every (employee, day) touched. This is the "pull" counterpart to
 * /api/punch's "push" ingestion — /api/punch only ever receives anything if
 * the device itself is configured to call it (ADMS/cloud push), which
 * nothing in this project sets up; without either path nothing reaches the
 * system no matter how many times someone actually punches on the device.
 *
 * Dedupes on (employeeId, timestamp) since AttendanceLog has no unique
 * constraint to lean on - safe to call repeatedly (e.g. a manual "Sync now"
 * clicked more than once, or a future periodic job overlapping this run).
 */
export async function syncDeviceAttendance(): Promise<AttendanceSyncResult> {
  const rawLogs = await fetchDeviceAttendanceLogs();
  rawLogs.sort((a, b) => a.recordTime.getTime() - b.recordTime.getTime());

  const employees = await prisma.employee.findMany({
    where: { biometricDeviceUserId: { not: null }, deletedAt: null },
    select: { id: true, biometricDeviceUserId: true },
  });
  const employeeByDeviceUserId = new Map(employees.map((e) => [e.biometricDeviceUserId!, e.id]));

  let imported = 0;
  let skippedDuplicate = 0;
  const unlinkedDeviceUserIds = new Set<string>();
  const touched = new Set<string>(); // `${employeeId}|${date}`
  // first punch of the day = in, otherwise out — per employee, tracked as we
  // walk the batch in time order so multiple new punches for the same day
  // in one sync resolve correctly relative to each other.
  const seenToday = new Map<string, number>(); // `${employeeId}|${date}` -> punch count so far today

  for (const log of rawLogs) {
    const employeeId = employeeByDeviceUserId.get(log.deviceUserId);
    if (!employeeId) {
      unlinkedDeviceUserIds.add(log.deviceUserId);
      continue;
    }

    const existing = await prisma.attendanceLog.findFirst({
      where: { employeeId, timestamp: log.recordTime },
      select: { id: true },
    });
    if (existing) {
      skippedDuplicate++;
      continue;
    }

    const dateStr = log.recordTime.toISOString().slice(0, 10);
    const dayKey = `${employeeId}|${dateStr}`;
    const priorToday =
      seenToday.get(dayKey) ??
      (await prisma.attendanceLog.count({
        where: {
          employeeId,
          timestamp: {
            gte: new Date(`${dateStr}T00:00:00.000Z`),
            lt: new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
          },
        },
      }));
    seenToday.set(dayKey, priorToday + 1);

    await prisma.attendanceLog.create({
      data: {
        employeeId,
        deviceUserId: log.deviceUserId,
        timestamp: log.recordTime,
        punchType: priorToday === 0 ? "in" : "out",
        source: "biometric",
      },
    });
    imported++;
    touched.add(dayKey);
  }

  for (const key of touched) {
    const [employeeId, date] = key.split("|");
    await recalculateDailyAttendance(employeeId, date);
  }

  return {
    imported,
    skippedUnlinked: unlinkedDeviceUserIds.size,
    skippedDuplicate,
    unlinkedDeviceUserIds: [...unlinkedDeviceUserIds],
  };
}

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let autoSyncStarted = false;

/**
 * Runs syncDeviceAttendance() on a timer for the lifetime of the server
 * process. Safe to call more than once (e.g. hot reload in dev) - only the
 * first call actually schedules anything. Meant to be started once from
 * instrumentation.ts when the server boots; this app runs as a persistent
 * Windows Service (not serverless), so a plain setInterval lives as long as
 * the process does, which is what we want here.
 */
export function startAttendanceAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  const tick = async () => {
    try {
      const result = await syncDeviceAttendance();
      if (result.imported > 0) {
        console.log(`[attendance-auto-sync] imported ${result.imported} punch(es), ${result.skippedUnlinked} from unlinked device user(s)`);
      }
    } catch (e) {
      console.error("[attendance-auto-sync] sync failed:", e instanceof Error ? e.message : e);
    }
  };

  setInterval(tick, AUTO_SYNC_INTERVAL_MS);
  console.log(`[attendance-auto-sync] started, syncing every ${AUTO_SYNC_INTERVAL_MS / 60000} minute(s)`);
}
