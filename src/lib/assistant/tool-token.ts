import crypto from "node:crypto";

// The assistant's tools run inside the app, but the model reaches them from a separate process. This is the
// pass that process carries: it names who asked, expires in minutes, and is signed with a key derived from the
// session secret under its own label, so a session cookie can never be used as one, or the other way round.

const TTL_MS = 3 * 60_000;

export interface ToolTokenPayload {
  uid: string;
  loc: "ar" | "en";
  exp: number;
}

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is missing or too short (need >= 16 chars).");
  return crypto.createHash("sha256").update(`assistant-tool:${s}`).digest();
}

const mac = (body: string) => crypto.createHmac("sha256", key()).update(body).digest("base64url");

export function signToolToken(who: { uid: string; loc: "ar" | "en" }, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ uid: who.uid, loc: who.loc, exp: now + TTL_MS } satisfies ToolTokenPayload)).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function verifyToolToken(raw: string | null | undefined, now = Date.now()): ToolTokenPayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  const expected = mac(body);
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ToolTokenPayload>;
    if (typeof p.uid !== "string" || !p.uid || (p.loc !== "ar" && p.loc !== "en") || typeof p.exp !== "number") return null;
    return p.exp > now ? { uid: p.uid, loc: p.loc, exp: p.exp } : null;
  } catch {
    return null;
  }
}
