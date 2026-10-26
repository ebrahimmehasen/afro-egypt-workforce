import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signToolToken, verifyToolToken } from "@/lib/assistant/tool-token";
import { encodeSession } from "@/lib/session";

const SECRET = "test-secret-with-more-than-16-chars";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved;
});

describe("tool tokens", () => {
  it("round-trips who asked and in which language", () => {
    const token = signToolToken({ uid: "user-1", loc: "ar" }, 1_000);
    expect(verifyToolToken(token, 2_000)).toMatchObject({ uid: "user-1", loc: "ar" });
  });

  it("expires after a few minutes", () => {
    const token = signToolToken({ uid: "u", loc: "en" }, 0);
    expect(verifyToolToken(token, 2 * 60_000)).not.toBeNull();
    expect(verifyToolToken(token, 3 * 60_000 + 1)).toBeNull();
  });

  it("refuses a changed payload", () => {
    const token = signToolToken({ uid: "user-1", loc: "ar" }, 1_000);
    const [, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin-2", loc: "ar", exp: 9e15 })).toString("base64url");
    expect(verifyToolToken(`${forged}.${mac}`, 2_000)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = signToolToken({ uid: "u", loc: "ar" }, 1_000);
    process.env.SESSION_SECRET = "a-completely-different-secret-value";
    expect(verifyToolToken(token, 2_000)).toBeNull();
  });

  it("is not interchangeable with a session cookie", () => {
    const session = encodeSession({ id: "u", name: "x", email: "x@x", role: "admin" });
    expect(verifyToolToken(session, 1)).toBeNull();
    const [body] = signToolToken({ uid: "u", loc: "ar" }, 1_000).split(".");
    const asSession = `${body}.${crypto.createHmac("sha256", SECRET).update(body).digest("base64url")}`;
    expect(verifyToolToken(asSession, 2_000)).toBeNull();
  });

  it.each([undefined, null, "", "nodot", ".onlymac", "a.b"])("refuses %j", (raw) => expect(verifyToolToken(raw as string | null | undefined)).toBeNull());

  it("needs a real secret to sign", () => {
    process.env.SESSION_SECRET = "short";
    expect(() => signToolToken({ uid: "u", loc: "ar" })).toThrow(/SESSION_SECRET/);
  });
});
