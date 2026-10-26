import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDb } from "@/lib/data";
import { getDictionary } from "@/lib/i18n";
import { today } from "@/lib/today";
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

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const body = await req.json().catch(() => null);

  const reply = await handleToolRequest(req.headers.get("authorization"), body, {
    loadUser: async (uid) => {
      const row = await prisma.user.findUnique({ where: { id: uid }, select: { role: true, active: true } });
      return row ? { role: row.role, active: row.active } : null;
    },
    loadStore,
    dictionary: getDictionary,
    today,
  });
  return NextResponse.json(reply.json, { status: reply.status });
}
