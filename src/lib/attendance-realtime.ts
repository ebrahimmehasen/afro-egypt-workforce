import { startRealtimeListener, stopRealtimeListener, isRealtimeListenerActive, isRealtimeListenerPaused, RawAttendanceRecord } from "@/lib/zk-device";
import { ingestOneRecord } from "@/lib/attendance-ingest";
import { syncDeviceAttendance } from "@/lib/attendance-sync";

let initialized = false;
// Belt-and-braces backstop, not the primary path: catches anything the
// real-time listener could have missed (a reconnect window, a dropped
// event) without anyone needing to notice or act. Real-time delivery is
// normally instant.
const SAFETY_NET_INTERVAL_MS = 60 * 1000;

async function handleRealtimeRecord(r: RawAttendanceRecord) {
  try {
    await ingestOneRecord(r.deviceUserId, r.recordTime);
  } catch (e) {
    console.error("[attendance-realtime] failed to ingest a punch:", e instanceof Error ? e.message : e);
  }
}

/** Starts the real-time listener and the safety-net poll. Call once per
 * server process (see src/lib/startup.ts). */
export function initAttendanceRealtime() {
  if (initialized) return;
  initialized = true;

  startRealtimeListener(handleRealtimeRecord)
    .then(() => console.log("[attendance-realtime] listening for punches in real time"))
    .catch((e) => console.error("[attendance-realtime] initial connect failed (will keep retrying):", e instanceof Error ? e.message : e));

  setInterval(async () => {
    try {
      await syncDeviceAttendance();
    } catch {
      // device likely unreachable right now - the real-time listener's own
      // reconnect loop is already handling that; nothing else to do here.
    }
  }, SAFETY_NET_INTERVAL_MS);

  console.log(`[attendance-realtime] safety-net poll every ${SAFETY_NET_INTERVAL_MS / 1000}s`);
}

/** Manual "Pause" — releases the device connection so other operations (or
 * someone at the device's own physical menu) don't contend with it. */
export async function pauseAttendanceRealtime(): Promise<void> {
  await stopRealtimeListener({ userInitiated: true });
}

/** Manual "Resume" — catches up on whatever happened while paused, then
 * restarts the listener. */
export async function resumeAttendanceRealtime(): Promise<void> {
  await syncDeviceAttendance();
  await startRealtimeListener(handleRealtimeRecord);
}

export function attendanceRealtimeStatus(): "connected" | "paused" | "reconnecting" {
  if (isRealtimeListenerActive()) return "connected";
  if (isRealtimeListenerPaused()) return "paused";
  return "reconnecting";
}
