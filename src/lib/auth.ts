import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { User } from "@/lib/types";
import { decodeSession, encodeSession } from "@/lib/session";

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

export async function setSessionCookie(user: User) {
  (await cookies()).set(SESSION_COOKIE, encodeSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
