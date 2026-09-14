// Server-only: talks to hardware over raw TCP via node-zklib — never import from client components.
const ZKLib = require("node-zklib");
const { COMMANDS, REQUEST_DATA } = require("node-zklib/constants");
import { prisma } from "@/lib/prisma";

const SINGLETON = "singleton";
const CONNECT_TIMEOUT_MS = 8000;
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

export type DeviceSnapshot =
  | { online: true; info: DeviceInfo; users: DeviceUser[] }
  | { online: false; error: string };

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

/** Opens a short-lived connection, runs `fn`, always disconnects — the device only tolerates one client at a time. */
async function withDevice<T>(fn: (zk: any) => Promise<T>): Promise<T> {
  const { ip, port } = await getDeviceConnection();
  const zk = new ZKLib(ip, port, CONNECT_TIMEOUT_MS, REPLY_TIMEOUT_MS);
  await zk.createSocket();
  try {
    return await fn(zk);
  } finally {
    try {
      await zk.disconnect();
    } catch {
      // best-effort close
    }
  }
}

/** Tests a connection against arbitrary (possibly unsaved) settings — used by the
 * "Test connection" button before the user commits new IP/port/password. */
export async function testDeviceConnection(conn: DeviceConnection): Promise<{ ok: true } | { ok: false; error: string }> {
  const zk = new ZKLib(conn.ip, conn.port, CONNECT_TIMEOUT_MS, REPLY_TIMEOUT_MS);
  try {
    await zk.createSocket();
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

export async function getDeviceSnapshot(): Promise<DeviceSnapshot> {
  try {
    return await withDevice(async (zk) => {
      const info = await zk.getInfo();
      const rawUsers = await fetchUsersUtf8(zk);
      const users: DeviceUser[] = rawUsers.map((u) => ({
        uid: u.uid,
        userId: String(u.userId ?? u.uid),
        name: u.name || `#${u.uid}`,
        role: u.role ?? 0,
        cardno: u.cardno ?? 0,
      }));
      return {
        online: true,
        info: {
          userCounts: info?.userCounts ?? users.length,
          logCounts: info?.logCounts ?? 0,
          logCapacity: info?.logCapacity ?? 0,
        },
        users,
      };
    });
  } catch (e) {
    return { online: false, error: e instanceof Error ? e.message : String(e) };
  }
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
  await withDevice(async (zk) => {
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
  await withDevice((zk) => zk.executeCmd(COMMANDS.CMD_DELETE_USER, uidPayload(uid)));
}

/** Deletes one finger's template (0-9) for a user, leaving the user record and other fingers intact. */
export async function deleteDeviceFingerprint(uid: number, fingerIndex: number): Promise<void> {
  await withDevice((zk) => zk.executeCmd(COMMANDS.CMD_DELETE_USERTEMP, uidFingerPayload(uid, fingerIndex)));
}

/**
 * Puts the device into enrollment mode for one user/finger slot — the screen
 * will prompt for a finger. The person MUST be physically at the device; no
 * protocol can capture a live fingerprint without that. Best-effort: exact
 * payload layout can vary by firmware generation.
 */
export async function startDeviceEnroll(uid: number, fingerIndex: number): Promise<void> {
  await withDevice((zk) => zk.executeCmd(COMMANDS.CMD_STARTENROLL, enrollPayload(uid, fingerIndex)));
}

export async function cancelDeviceCapture(): Promise<void> {
  await withDevice((zk) => zk.executeCmd(COMMANDS.CMD_CANCELCAPTURE, Buffer.alloc(0)));
}

export async function restartDevice(): Promise<void> {
  await withDevice((zk) => zk.executeCmd(COMMANDS.CMD_RESTART, Buffer.alloc(0)));
}

/** Disabled = device stops accepting punches/verification (screen shows "in use"); re-enable to resume. Fully reversible. */
export async function setDeviceEnabled(enabled: boolean): Promise<void> {
  await withDevice((zk) => (enabled ? zk.enableDevice() : zk.disableDevice()));
}

/** Wipes the device's own internal attendance log buffer. Irreversible; does not touch our AttendanceLog table. */
export async function clearDeviceAttendanceLog(): Promise<void> {
  await withDevice((zk) => zk.clearAttendanceLog());
}
