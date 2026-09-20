import { startRealtimeListener, stopRealtimeListener, isRealtimeListenerActive, isRealtimeListenerPaused, RawAttendanceRecord } from "@/lib/zk-device";
import { ingestOneRecord } from "@/lib/attendance-ingest";
import { syncDeviceAttendance } from "@/lib/attendance-sync";

let initialized = false;
let catchingUp = false;
// Belt-and-braces backstop, not the primary path. Real-time delivery is normally instant, and every
// reconnect after a gap already triggers a catch-up, so this only guards against a silently missed
// event. A full sync downloads the device's whole log, so it is deliberately infrequent.
const SAFETY_NET_INTERVAL_MS = 10 * 60 * 1000;

async function handleRealtimeRecord(r: RawAttendanceRecord) {
  try {
    await ingestOneRecord(r.deviceUserId, r.recordTime);
  } catch (e) {
    console.error("[attendance-realtime] failed to ingest a punch:", e instanceof Error ? e.message : e);
  }
}

/** Pulls in whatever the listener could have missed. Never overlaps itself, and a failure
 * (device unreachable again) is just logged — the next reconnect tries again. */
async function catchUp(reason: string) {
  if (catchingUp) return;
  catchingUp = true;
  try {
    const r = await syncDeviceAttendance();
    console.log(`[attendance-realtime] catch-up (${reason}): ${r.imported} new punch(es)`);
  } catch (e) {
    console.error(`[attendance-realtime] catch-up (${reason}) failed:`, e instanceof Error ? e.message : e);
  } finally {
    catchingUp = false;
  }
}

/** Starts the real-time listener and the safety-net poll. Call once per
 * server process (see src/lib/startup.ts). */
export function initAttendanceRealtime() {
  if (initialized) return;
  initialized = true;

  // The catch-up runs after the first successful connect and after every reconnect that follows
  // a dropped connection — so a power cut or restart is healed as soon as the device is back.
  startRealtimeListener(handleRealtimeRecord, () => void catchUp("reconnected"))
    .then(() => console.log("[attendance-realtime] listening for punches in real time"))
    .catch((e) => console.error("[attendance-realtime] initial connect failed (will keep retrying):", e instanceof Error ? e.message : e));

  setInterval(() => {
    // Nothing to back up while the device is unreachable or paused: the reconnect catch-up covers that.
    if (isRealtimeListenerActive()) void catchUp("safety net");
  }, SAFETY_NET_INTERVAL_MS);

  console.log(`[attendance-realtime] safety-net catch-up every ${SAFETY_NET_INTERVAL_MS / 60000} min`);
}

/** Manual "Pause" — releases the device connection so other operations (or
 * someone at the device's own physical menu) don't contend with it. */
export async function pauseAttendanceRealtime(): Promise<void> {
  await stopRealtimeListener({ userInitiated: true });
}

/** Manual "Resume" — catches up on whatever happened while paused, then restarts the listener.
 * If the device is unreachable it doesn't fail: the listener keeps retrying by itself, and the
 * status shown on the page says so. */
export async function resumeAttendanceRealtime(): Promise<void> {
  await catchUp("resumed");
  try {
    await startRealtimeListener(handleRealtimeRecord);
  } catch (e) {
    console.error("[attendance-realtime] resume: device not reachable yet, retrying in the background:", e instanceof Error ? e.message : e);
  }
}

export function attendanceRealtimeStatus(): "connected" | "paused" | "reconnecting" {
  if (isRealtimeListenerActive()) return "connected";
  if (isRealtimeListenerPaused()) return "paused";
  return "reconnecting";
}
