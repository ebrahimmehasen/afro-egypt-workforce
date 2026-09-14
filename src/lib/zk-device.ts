// Server-only: talks to hardware over raw TCP via node-zklib — never import from client components.
const ZKLib = require("node-zklib");
const { COMMANDS } = require("node-zklib/constants");
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

export async function getDeviceSnapshot(): Promise<DeviceSnapshot> {
  try {
    return await withDevice(async (zk) => {
      const info = await zk.getInfo();
      const usersRes = await zk.getUsers();
      const users: DeviceUser[] = (usersRes?.data ?? []).map((u: any) => ({
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
