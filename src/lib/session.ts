import crypto from "node:crypto";
import { User } from "@/lib/types";

/**
 * Session payload signing. The cookie holds `base64url(json).base64url(hmac)`;
 * a tampered or unsigned cookie is rejected. Not encrypted — never put secrets
 * in the payload, only the user identity fields the app already exposes.
 */
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short (need >= 16 chars). Set it in .env.");
  }
  return s;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

export function encodeSession(user: User): string {
  const body = Buffer.from(JSON.stringify(user)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(raw: string | undefined): User | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(body);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as User;
  } catch {
    return null;
  }
}
