import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { User } from "@/lib/types";
import { decodeSession, encodeSession } from "@/lib/session";
import { canAccess } from "@/lib/permissions";

const SESSION_COOKIE = "afro_egypt_session";
const MAX_AGE = 60 * 60 * 8; // 8 hours

export async function getSession(): Promise<User | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Use in server components that must have a session — redirects to /login if not. */
export async function requireSession(): Promise<User> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/**
 * The page-authorization chokepoint. Verifies the signed session AND that the
 * role may reach `path` (`middleware.ts` does the same check for a fast UX
 * redirect, but on the *unsigned* cookie — this is the authoritative one, on
 * verified data). Every protected page in the (app) group calls this with its
 * own route instead of a bare `requireSession()`.
 */
export async function requireAccess(path: string): Promise<User> {
  const user = await requireSession();
  if (!canAccess(user.role, path)) redirect("/dashboard");
  return user;
}

export async function setSessionCookie(user: User) {
  // secure by default in production; set SECURE_COOKIES=false only when serving
  // prod over plain HTTP behind a trusted network / reverse proxy.
  const secure = process.env.NODE_ENV === "production" && process.env.SECURE_COOKIES !== "false";
  (await cookies()).set(SESSION_COOKIE, encodeSession(user), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
