import { NextRequest, NextResponse } from "next/server";
import { canAccess } from "@/lib/permissions";
import { Role } from "@/lib/types";

const SESSION_COOKIE = "afro_egypt_session";
const PUBLIC_PATHS = ["/login"];
const ALWAYS_ALLOWED = ["/dashboard", "/payslip"];

/**
 * Reads role + permissions out of the signed session cookie WITHOUT verifying
 * the signature — this is only a coarse UX redirect. Real enforcement is
 * `requireAccess()` in each (app) page (see src/lib/auth.ts), which verifies
 * the session signature and checks role/permissions-vs-path itself. Employee
 * files (/api/employees/[id]/documents|acknowledgments) are under /api, so
 * this middleware never runs on them at all — they carry their own session +
 * per-record scope check (canViewEmployee).
 */
function userFromCookie(raw: string): { role: Role; permissions: string[] } | null {
  try {
    const body = raw.slice(0, raw.lastIndexOf("."));
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!json?.role) return null;
    return { role: json.role, permissions: Array.isArray(json.permissions) ? json.permissions : [] };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionRaw = request.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = Boolean(sessionRaw);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (hasSession && !isPublic && !ALWAYS_ALLOWED.some((p) => pathname.startsWith(p))) {
    const user = userFromCookie(sessionRaw!);
    if (user && !canAccess(user, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|brand|favicon.ico).*)"],
};
