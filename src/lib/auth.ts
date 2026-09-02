import { cookies } from "next/headers";
import { User } from "@/lib/types";

const SESSION_COOKIE = "afro_egypt_session";

export interface DemoCredential {
  email: string;
  password: string;
  user: User;
}

export const DEMO_USERS: DemoCredential[] = [
  {
    email: "admin@404legends.demo",
    password: "demo123",
    user: { id: "USR-1", name: "مدير النظام", email: "admin@404legends.demo", role: "admin" },
  },
  {
    email: "hr@afroegypt.demo",
    password: "demo123",
    user: { id: "USR-2", name: "Ahmed HR", email: "hr@afroegypt.demo", role: "hr" },
  },
  {
    email: "supervisor@afroegypt.demo",
    password: "demo123",
    user: {
      id: "USR-3",
      name: "مشرف الإنتاج",
      email: "supervisor@afroegypt.demo",
      role: "supervisor",
      departmentId: "DEP-1",
    },
  },
  {
    email: "ahmed@afroegypt.demo",
    password: "demo123",
    user: {
      id: "USR-4",
      name: "أحمد علي",
      email: "ahmed@afroegypt.demo",
      role: "employee",
      employeeId: "EMP-1001",
    },
  },
];

export function findCredential(email: string, password: string): DemoCredential | undefined {
  return DEMO_USERS.find(
    (c) => c.email.toLowerCase() === email.trim().toLowerCase() && c.password === password,
  );
}

export function getSession(): User | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setSessionCookie(user: User) {
  cookies().set(SESSION_COOKIE, JSON.stringify(user), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 1 day — demo session
  });
}

export function clearSessionCookie() {
  cookies().delete(SESSION_COOKIE);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
