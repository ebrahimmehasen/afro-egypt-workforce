// Server-only: talks to hardware over raw TCP via node-zklib — never import from client components.
const ZKLib = require("node-zklib");
const { COMMANDS, REQUEST_DATA } = require("node-zklib/constants");
import { prisma } from "@/lib/prisma";
import { BoundedCache, createBoundedCache, createMutex, reconnectDelay, realtimeStatus, RealtimeStatus } from "@/lib/device-resilience";

const SINGLETON = "singleton";
// A device on the same LAN answers in milliseconds, so waiting longer to connect only makes
// an unreachable one (power cut, cable out) slower to report.
const CONNECT_TIMEOUT_MS = 4000;
const REPLY_TIMEOUT_MS = 8000;

export interface DeviceConnection {
  ip: string;
  port: number;
  commPassword: number;
}

export interface DeviceInfo {
  userCounts: number;
  logCounts: number;
  logCapacity: number;
}

export interface DeviceUser {
  uid: number;
  userId: string;
  name: string;
  role: number;
  cardno: number;
}

/** Connection settings row — auto-seeded on first read with the device IP found during setup. */
export async function getDeviceConnection(): Promise<DeviceConnection> {
  const row = await prisma.biometricDeviceSettings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON, ip: "192.168.1.201", port: 4370, commPassword: 0 },
  });
  return { ip: row.ip, port: row.port, commPassword: row.commPassword };
}

export async function saveDeviceConnection(conn: DeviceConnection): Promise<void> {
  await prisma.biometricDeviceSettings.upsert({
    where: { id: SINGLETON },
    update: conn,
    create: { id: SINGLETON, ...conn },
  });
}

/**
 * Opens the connection with a real deadline. node-zklib's `timeout` argument only marks the socket
 * idle — it never abandons a connect — so a device that is powered off (or a cable that is out) left
 * every caller hanging until the OS gave up, 20+ seconds later and repeated for each attempt. On the
 * deadline the half-open sockets are torn down, so nothing lingers holding the device's single slot.
 */
async function openSocket(zk: any, ms: number = CONNECT_TIMEOUT_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const attempt = Promise.resolve(zk.createSocket());
  attempt.catch(() => {}); // if the deadline wins, a later failure of this attempt is nobody's business
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        zk.zklibTcp?.socket?.destroy();
      } catch {
        // already gone
      }
      Promise.resolve(zk.disconnect?.()).catch(() => {});
      reject(new Error(`Could not reach the device within ${ms / 1000}s`));
    }, ms);
  });
  try {
    await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// --- Real-time listener state ------------------------------------------
// The device only tolerates one connected client at a time. The real-time
// listener holds a connection open indefinitely, so every short-lived
// operation below (withDevice) pauses it first and brings it back afterwards -
// nobody calling e.g. renameDeviceUser or linkDeviceUserAction needs to know
// the listener exists at all.
//
// All connection work goes through one mutex. A page load, a sync and the
// listener's own reconnect used to run at the same time and fight for that
// single slot, which is what made everything crawl (and the page hang) after
// a power cut or restart.
// Everything that has to be ONE thing per server process lives on globalThis. Next.js compiles this
// module into several bundles (the layout that starts the listener, each page, each group of server
// actions) and every bundle gets its own copy of module-level variables. With plain module state the
// listener lived in one copy while the status poll, the pause/resume buttons, the page's own device
// reads and the cache invalidation all talked to other copies that never saw it: the badge said
// "disconnected", and those operations fought the listener for the device's single connection.
interface ZkShared {
  runExclusive: ReturnType<typeof createMutex>;
  overviewCache: BoundedCache<DeviceOverview> | null;
  realtimeZk: any;
  realtimeCallback: ((r: RawAttendanceRecord) => void) | null;
  realtimeOnReconnected: (() => void) | null;
  realtimeUserPaused: boolean;
  realtimeReconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  // True while punches may have happened that the listener didn't hear: the server
  // just started, or the connection dropped. Cleared - and a catch-up triggered -
  // on the next successful connect. Our own pause/resume around an operation
  // deliberately doesn't set it.
  realtimeGap: boolean;
  // When the listener last went down, and how many of our own device operations are running (the
  // listener is switched off on purpose while one runs). Only used to report an honest status.
  realtimeDownSince: number | null;
  deviceOpsRunning: number;
}

const globalRef = globalThis as typeof globalThis & { __afroZkShared?: ZkShared };
const S: ZkShared = (globalRef.__afroZkShared ??= {
  runExclusive: createMutex(),
  overviewCache: null,
  realtimeZk: null,
  realtimeCallback: null,
  realtimeOnReconnected: null,
  realtimeUserPaused: false,
  realtimeReconnectTimer: null,
  reconnectAttempt: 0,
  realtimeGap: false,
  realtimeDownSince: null,
  deviceOpsRunning: 0,
});

function attachRealtimeSocketHandlers(zk: any) {
  const socket = zk?.zklibTcp?.socket;
  if (!socket) return;
  // Deliberately NO TCP keep-alive here: the device doesn't answer the probes, so enabling it made the OS
  // kill a perfectly healthy connection every ~30s (idle + failed probes) and the listener flapped forever.
  // A device that loses power without closing its end is caught by the periodic catch-up instead, which
  // makes a fresh connection and so notices it's gone.
  const onDrop = () => {
    if (S.realtimeZk !== zk) return; // a newer connection already replaced this one
    S.realtimeZk = null;
    S.realtimeDownSince = Date.now();
    S.realtimeGap = true;
    if (!S.realtimeUserPaused && S.realtimeCallback) scheduleRealtimeReconnect();
  };
  socket.once("close", onDrop);
  socket.once("error", onDrop);
}

/** Retries with a growing delay so a device that's still booting (or still holding our old
 * session after a power cut) isn't hammered. `delayMs = 0` is used to bring the listener back
 * right after one of our own operations. */
function scheduleRealtimeReconnect(delayMs: number = reconnectDelay(S.reconnectAttempt)) {
  if (S.realtimeReconnectTimer) return;
  S.realtimeReconnectTimer = setTimeout(async () => {
    S.realtimeReconnectTimer = null;
    if (S.realtimeUserPaused || !S.realtimeCallback) return;
    try {
      await connectRealtimeNow();
    } catch (e) {
      S.reconnectAttempt += 1;
      S.realtimeGap = true;
      console.error("[attendance-realtime] reconnect failed:", e instanceof Error ? e.message : e);
      scheduleRealtimeReconnect();
    }
  }, delayMs);
}

async function connectRealtimeNow(): Promise<void> {
  await S.runExclusive(async () => {
    if (S.realtimeZk || S.realtimeUserPaused) return;
    const { ip, port } = await getDeviceConnection();
    const zk = new ZKLib(ip, port, CONNECT_TIMEOUT_MS, REPLY_TIMEOUT_MS);
    await openSocket(zk);
    try {
      await zk.zklibTcp.getRealTimeLogs((raw: { userId: string; attTime: Date }) => {
        S.realtimeCallback?.({ deviceUserId: String(raw.userId), recordTime: raw.attTime });
      });
    } catch (e) {
      try {
        await zk.disconnect();
      } catch {
        // best-effort close
      }
      throw e;
    }
    S.realtimeZk = zk;
    S.realtimeDownSince = null;
    attachRealtimeSocketHandlers(zk);
  });

  S.reconnectAttempt = 0;
  if (S.realtimeGap && S.realtimeZk) {
    S.realtimeGap = false;
    S.realtimeOnReconnected?.();
  }
}

/** Starts (or restarts) the persistent real-time punch listener. `onRecord` fires once per
 * punch, as it happens. `onReconnected` runs after every connect that follows a gap - including
 * the very first one after the server starts - so punches made while we weren't listening get
 * caught up. If this connect fails it throws, but a retry is already scheduled. */
export async function startRealtimeListener(
  onRecord: (r: RawAttendanceRecord) => void,
  onReconnected?: () => void,
): Promise<void> {
  S.realtimeCallback = onRecord;
  if (onReconnected) {
    S.realtimeOnReconnected = onReconnected;
    S.realtimeGap = true;
  }
  S.realtimeUserPaused = false;
  S.realtimeDownSince ??= Date.now();
  if (S.realtimeReconnectTimer) {
    clearTimeout(S.realtimeReconnectTimer);
    S.realtimeReconnectTimer = null;
  }
  try {
    await connectRealtimeNow();
  } catch (e) {
    S.realtimeGap = true;
    S.reconnectAttempt += 1;
    scheduleRealtimeReconnect();
    throw e;
  }
}

/** Stops the real-time listener. `userInitiated: true` (the manual Pause
 * button) prevents auto-reconnect until startRealtimeListener/resume is
 * called again; withDevice's internal pause/resume never sets that flag. */
export async function stopRealtimeListener(opts: { userInitiated?: boolean } = {}): Promise<void> {
  if (opts.userInitiated) {
    S.realtimeUserPaused = true;
  }
  if (S.realtimeReconnectTimer) {
    clearTimeout(S.realtimeReconnectTimer);
    S.realtimeReconnectTimer = null;
  }
  const zk = S.realtimeZk;
  S.realtimeZk = null;
  if (zk) {
    S.realtimeDownSince = Date.now();
    try {
      await zk.disconnect();
    } catch {
      // best-effort close
    }
  }
}

export function isRealtimeListenerActive(): boolean {
  return S.realtimeZk !== null;
}

export function isRealtimeListenerPaused(): boolean {
  return S.realtimeUserPaused;
}

/** The status to show — see realtimeStatus for why it isn't just "is the socket open right now". */
export function getRealtimeConnectionStatus(): RealtimeStatus {
  return realtimeStatus({
    active: isRealtimeListenerActive(),
    userPaused: S.realtimeUserPaused,
    opsRunning: S.deviceOpsRunning,
    downSince: S.realtimeDownSince,
    failedAttempts: S.reconnectAttempt,
    now: Date.now(),
  });
}

/** Opens a short-lived connection, runs `fn`, always disconnects — the device only tolerates one client at a time. */
async function withDevice<T>(fn: (zk: any) => Promise<T>): Promise<T> {
  let resumeListener = false;
  try {
    return await S.runExclusive(async () => {
      S.deviceOpsRunning += 1;
      try {
        resumeListener = isRealtimeListenerActive();
        if (resumeListener) await stopRealtimeListener();

        const { ip, port } = await getDeviceConnection();
        const zk = new ZKLib(ip, port, CONNECT_TIMEOUT_MS, REPLY_TIMEOUT_MS);
        await openSocket(zk);
        try {
          return await fn(zk);
        } finally {
          try {
            await zk.disconnect();
          } catch {
            // best-effort close
          }
        }
      } finally {
        S.deviceOpsRunning -= 1;
      }
    });
  } finally {
    // Runs even when the device couldn't be reached, so the listener always gets a retry
    // instead of being left switched off.
    if (resumeListener && !S.realtimeUserPaused && S.realtimeCallback) scheduleRealtimeReconnect(0);
  }
}

/** withDevice for anything that changes what the device holds, so the cached overview isn't served stale afterwards. */
async function withDeviceWrite<T>(fn: (zk: any) => Promise<T>): Promise<T> {
  try {
    return await withDevice(fn);
  } finally {
    overviewCache.invalidate();
  }
}

/** Tests a connection against arbitrary (possibly unsaved) settings — used by the
 * "Test connection" button before the user commits new IP/port/password. */
export async function testDeviceConnection(conn: DeviceConnection): Promise<{ ok: true } | { ok: false; error: string }> {
  const zk = new ZKLib(conn.ip, conn.port, CONNECT_TIMEOUT_MS, REPLY_TIMEOUT_MS);
  try {
    await openSocket(zk);
    await zk.getInfo();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      await zk.disconnect();
    } catch {
      // best-effort close
    }
  }
}

interface RawDeviceUser {
  uid: number;
  role: number;
  password: string;
  name: string;
  cardno: number;
  userId: string;
}

/**
 * node-zklib's own `zk.getUsers()` decodes the name field with
 * `Buffer.toString('ascii')`, which only keeps the low 7 bits of every byte -
 * fine for Latin names, but it silently mangles anything else (Arabic in
 * particular) into garbage, and the mangling is irreversible once decoded
 * (the original bytes are gone). This re-reads the exact same raw bytes via
 * the library's own (public) `zklibTcp.readWithBuffer` — the well-tested
 * chunked-pull mechanism underneath `getUsers()` — and decodes the name as
 * UTF-8 instead, which is what ZK firmware with Arabic-language support
 * actually stores there. Other fields keep the library's own decode logic
 * (ascii is fine for numeric/Latin content like passwords and userId).
 */
async function fetchUsersUtf8(zk: any): Promise<RawDeviceUser[]> {
  const tcp = zk.zklibTcp;
  await tcp.freeData().catch(() => {});
  const res = await tcp.readWithBuffer(REQUEST_DATA.GET_USERS);
  await tcp.freeData().catch(() => {});

  const RECORD_SIZE = 72;
  let buf: Buffer = res.data.subarray(4);
  const users: RawDeviceUser[] = [];
  while (buf.length >= RECORD_SIZE) {
    const rec = buf.subarray(0, RECORD_SIZE);
    users.push({
      uid: rec.readUIntLE(0, 2),
      role: rec.readUIntLE(2, 1),
      password: rec.subarray(3, 11).toString("ascii").split("\0")[0],
      name: rec.subarray(11, 35).toString("utf8").split("\0")[0],
      cardno: rec.readUIntLE(35, 4),
      userId: rec.subarray(48, 57).toString("ascii").split("\0")[0],
    });
    buf = buf.subarray(RECORD_SIZE);
  }
  return users;
}

export interface RawAttendanceRecord {
  deviceUserId: string;
  recordTime: Date;
}

function mapAttendances(res: any): RawAttendanceRecord[] {
  return (res?.data ?? []).map((r: any) => ({
    deviceUserId: String(r.deviceUserId),
    recordTime: r.recordTime instanceof Date ? r.recordTime : new Date(r.recordTime),
  }));
}

async function readUsers(zk: any): Promise<DeviceUser[]> {
  const rawUsers = await fetchUsersUtf8(zk);
  return rawUsers.map((u) => ({
    uid: u.uid,
    userId: String(u.userId ?? u.uid),
    name: u.name || `#${u.uid}`,
    role: u.role ?? 0,
    cardno: u.cardno ?? 0,
  }));
}

/** Pulls every punch currently sitting in the device's own log buffer (does
 * NOT clear it — clearDeviceAttendanceLog is a separate, explicit action). */
export async function fetchDeviceAttendanceLogs(): Promise<RawAttendanceRecord[]> {
  return withDevice(async (zk) => mapAttendances(await zk.getAttendances()));
}

export interface DeviceOverview {
  info: DeviceInfo;
  users: DeviceUser[];
  logs: RawAttendanceRecord[];
}

/** Everything the device pages show, read over ONE connection. */
async function loadOverview(): Promise<DeviceOverview> {
  return withDevice(async (zk) => {
    const info = await zk.getInfo();
    const users = await readUsers(zk);
    const logs = mapAttendances(await zk.getAttendances());
    return {
      info: {
        userCounts: info?.userCounts ?? users.length,
        logCounts: info?.logCounts ?? 0,
        logCapacity: info?.logCapacity ?? 0,
      },
      users,
      logs,
    };
  });
}

const OVERVIEW_FRESH_MS = 30_000;
const overviewCache = (S.overviewCache ??= createBoundedCache(loadOverview, { freshMs: OVERVIEW_FRESH_MS }));

export type DeviceOverviewResult =
  | ({ online: true; stale: boolean; fetchedAt: number } & DeviceOverview)
  | { online: false; error: string };

/**
 * The device's users, counters and full punch log, for the pages that display them. Waits at most
 * `maxWaitMs`: a slow or unreachable device (power cut, restart) can no longer hang a page. When the
 * device can't answer in time the last known data comes back with `stale: true`, or `online: false`
 * if there has never been any.
 */
export async function getDeviceOverview(maxWaitMs = 8000): Promise<DeviceOverviewResult> {
  const r = await overviewCache.get(maxWaitMs);
  return r.ok
    ? { online: true, stale: r.stale, fetchedAt: r.fetchedAt, ...r.value }
    : { online: false, error: r.error };
}

/** Forces the next getDeviceOverview to read from the device again. */
export function invalidateDeviceOverview() {
  overviewCache.invalidate();
}

// --- Raw protocol payloads (classic ZK "PULL SDK" wire format — same structs
// used by the widely-deployed pyzk / node-zklib ecosystem for these commands). ---

function uidPayload(uid: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(uid, 0);
  return buf;
}

function uidFingerPayload(uid: number, fingerIndex: number): Buffer {
  const buf = Buffer.alloc(3);
  buf.writeUInt16LE(uid, 0);
  buf.writeUInt8(fingerIndex, 2);
  return buf;
}

function enrollPayload(uid: number, fingerIndex: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt16LE(uid, 0);
  buf.writeUInt8(fingerIndex, 2);
  buf.writeUInt8(0, 3); // retry counter — always start at 0
  return buf;
}

/**
 * Builds the 72-byte TCP user record node-zklib's own `decodeUserData72`
 * (node_modules/node-zklib/utils.js) reads back — this is the exact layout
 * this library already uses to decode every user this device sends us via
 * getUsers(), so the offsets below aren't a guess: uid(2) + role(1) +
 * password(8, ascii) + name(24, ascii, starts at 11) + cardno(4, at 35) +
 * userId(9, ascii, at 48). CMD_USER_WRQ (write) mirrors the read record
 * layout, per the standard ZK "PULL SDK" protocol convention.
 */
function encodeUserData72(user: { uid: number; role: number; password: string; name: string; cardno: number; userId: string }): Buffer {
  const buf = Buffer.alloc(72);
  buf.writeUIntLE(user.uid, 0, 2);
  buf.writeUIntLE(user.role, 2, 1);
  buf.write(user.password.slice(0, 8), 3, 8, "ascii");
  // "ascii" masks every UTF-16 code unit down to 7 bits (val & 0x7F) - fine for
  // latin names, but it silently mangles anything outside that range (Arabic,
  // any other non-ASCII script) into near-random bytes. The name field is a
  // raw byte buffer, not a char array, and ZK firmware with Arabic-language
  // support stores/reads it as UTF-8, so encode it as UTF-8 here to match.
  buf.write(user.name, 11, 24, "utf8");
  buf.writeUIntLE(user.cardno, 35, 4);
  buf.write(user.userId.slice(0, 8), 48, 9, "ascii");
  return buf;
}

/**
 * Renames a user directly on the device. Re-reads the user's current full
 * record (role/password/cardno, which our DeviceUser type never exposes to
 * the client) immediately before writing, so the rest of the record round-
 * trips unchanged — only `name` differs from what's on the device right now.
 * Untested against real hardware (none available here); built strictly from
 * this library's own verified read-side byte layout, not a blind guess.
 */
export async function updateDeviceUserName(uid: number, newName: string): Promise<void> {
  await withDeviceWrite(async (zk) => {
    const users = await fetchUsersUtf8(zk);
    const current = users.find((u) => u.uid === uid);
    if (!current) throw new Error(`Device user uid=${uid} not found`);
    const payload = encodeUserData72({
      uid: current.uid,
      role: current.role,
      password: current.password,
      name: newName,
      cardno: current.cardno,
      userId: current.userId,
    });
    await zk.executeCmd(COMMANDS.CMD_USER_WRQ, payload);
  });
}

/** Deletes a user (and all their fingerprints/card/password) from the device entirely. */
export async function deleteDeviceUser(uid: number): Promise<void> {
  await withDeviceWrite((zk) => zk.executeCmd(COMMANDS.CMD_DELETE_USER, uidPayload(uid)));
}

/** Deletes one finger's template (0-9) for a user, leaving the user record and other fingers intact. */
export async function deleteDeviceFingerprint(uid: number, fingerIndex: number): Promise<void> {
  await withDeviceWrite((zk) => zk.executeCmd(COMMANDS.CMD_DELETE_USERTEMP, uidFingerPayload(uid, fingerIndex)));
}

/**
 * Puts the device into enrollment mode for one user/finger slot — the screen
 * will prompt for a finger. The person MUST be physically at the device; no
 * protocol can capture a live fingerprint without that. Best-effort: exact
 * payload layout can vary by firmware generation.
 */
export async function startDeviceEnroll(uid: number, fingerIndex: number): Promise<void> {
  await withDeviceWrite((zk) => zk.executeCmd(COMMANDS.CMD_STARTENROLL, enrollPayload(uid, fingerIndex)));
}

export async function cancelDeviceCapture(): Promise<void> {
  await withDeviceWrite((zk) => zk.executeCmd(COMMANDS.CMD_CANCELCAPTURE, Buffer.alloc(0)));
}

export async function restartDevice(): Promise<void> {
  await withDeviceWrite((zk) => zk.executeCmd(COMMANDS.CMD_RESTART, Buffer.alloc(0)));
}

/** Disabled = device stops accepting punches/verification (screen shows "in use"); re-enable to resume. Fully reversible. */
export async function setDeviceEnabled(enabled: boolean): Promise<void> {
  await withDeviceWrite((zk) => (enabled ? zk.enableDevice() : zk.disableDevice()));
}

/** Wipes the device's own internal attendance log buffer. Irreversible; does not touch our AttendanceLog table. */
export async function clearDeviceAttendanceLog(): Promise<void> {
  await withDeviceWrite((zk) => zk.clearAttendanceLog());
}
