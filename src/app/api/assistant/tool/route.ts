import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDb } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { today } from "@/lib/today";
import { dayStr } from "@/lib/serialize";
import type { AdminExtras } from "@/lib/assistant/admin-tools";
import { handleToolRequest } from "@/lib/assistant/tool-endpoint";
import type { Store } from "@/lib/store";

// Not a page and not for browsers: the assistant's tool process calls this with a short-lived signed token (see
// tool-token.ts). It sits under /api, which the middleware leaves alone, so it does its own checking.
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;
const STORE_CACHE_MS = 20_000;

// One question makes several tool calls in a row; they share a read of the database for a few seconds.
let cached: { at: number; db: Promise<Store> } | null = null;
function loadStore(): Promise<Store> {
  if (!cached || Date.now() - cached.at > STORE_CACHE_MS) {
    const db = getDb();
    const entry = { at: Date.now(), db };
    cached = entry;
    db.catch(() => {
      if (cached === entry) cached = null;
    });
  }
  return cached.db;
}


const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const iso = (d: Date | null) => d?.toISOString() ?? null;

// The admin pages' own reading, trimmed to the latest rows and to plain values (never a password hash, a device
// key or the device's communication password).
async function readExtras(): Promise<AdminExtras> {
  const [changeRequests, workRequests, auditLog, users, holidays, devices, biometric] = await Promise.all([
    prisma.changeRequest.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.workRequest.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.auditLogEntry.findMany({ orderBy: { timestamp: "desc" }, take: 300 }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.holiday.findMany({ orderBy: { from: "desc" }, take: 60 }),
    prisma.device.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.biometricDeviceSettings.findFirst(),
  ]);
  return {
    changeRequests: changeRequests.map((r) => ({
      requestedBy: r.requestedBy,
      module: r.module,
      actionLabel: r.actionLabel,
      summary: r.summary,
      payload: r.payload,
      status: r.status,
      direct: r.direct,
      reviewedBy: r.reviewedBy,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: iso(r.reviewedAt),
    })),
    workRequests: workRequests.map((r) => ({
      type: r.type,
      date: dayStr(r.date),
      fromTime: r.fromTime,
      toTime: r.toTime,
      details: r.details,
      employeeIds: asStrings(r.employeeIds),
      status: r.status,
      requestedBy: r.requestedBy,
      decidedBy: r.decidedBy,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    })),
    auditLog: auditLog.map((e) => ({ userName: e.userName, action: e.action, module: e.module, oldValue: e.oldValue, newValue: e.newValue, reason: e.reason, timestamp: e.timestamp.toISOString() })),
    users: users.map((u) => ({
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      permissions: asStrings(u.permissions),
      directEdit: u.directEdit,
      employeeId: u.employeeId,
      departmentIds: asStrings(u.departmentIds),
      lastLoginAt: iso(u.lastLoginAt),
      createdAt: u.createdAt.toISOString(),
    })),
    holidays: holidays.map((h) => ({ name: h.name, from: dayStr(h.from), to: dayStr(h.to) })),
    devices: devices.map((d) => ({ name: d.name, location: d.location, active: d.active })),
    biometric: biometric ? { ip: biometric.ip, port: biometric.port } : null,
  };
}

let cachedExtras: { at: number; value: Promise<AdminExtras> } | null = null;
function loadExtras(): Promise<AdminExtras> {
  if (!cachedExtras || Date.now() - cachedExtras.at > STORE_CACHE_MS) {
    const entry = { at: Date.now(), value: readExtras() };
    cachedExtras = entry;
    entry.value.catch(() => {
      if (cachedExtras === entry) cachedExtras = null;
    });
  }
  return cachedExtras.value;
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const body = await req.json().catch(() => null);

  const reply = await handleToolRequest(req.headers.get("authorization"), body, {
    loadUser: async (uid) => {
      const row = await prisma.user.findUnique({ where: { id: uid }, select: { role: true, active: true } });
      return row ? { role: row.role, active: row.active } : null;
    },
    loadStore,
    loadExtras,
    dictionary: getDictionary,
    today,
  });
  return NextResponse.json(reply.json, { status: reply.status });
}
