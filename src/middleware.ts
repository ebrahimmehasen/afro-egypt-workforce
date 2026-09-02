import { NextRequest, NextResponse } from "next/server";
import { canAccess } from "@/lib/permissions";
import { Role } from "@/lib/types";

const SESSION_COOKIE = "afro_egypt_session";
const PUBLIC_PATHS = ["/login"];
const ALWAYS_ALLOWED = ["/dashboard", "/demo", "/payslip"];

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
    try {
      const session = JSON.parse(sessionRaw!) as { role: Role };
      if (!canAccess(session.role, pathname)) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }
    } catch {
      // malformed cookie — fall through, page-level auth will handle it
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|brand|favicon.ico).*)"],
};
