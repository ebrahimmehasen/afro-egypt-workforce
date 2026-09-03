import { NextRequest, NextResponse } from "next/server";
import { canAccess } from "@/lib/permissions";
import { Role } from "@/lib/types";

const SESSION_COOKIE = "afro_egypt_session";
const PUBLIC_PATHS = ["/login"];
const ALWAYS_ALLOWED = ["/dashboard", "/payslip"];

/**
 * Reads the role out of the signed session cookie WITHOUT verifying the
 * signature — this is only a coarse UX redirect. Real enforcement is in
 * (app)/layout.tsx via getSession(), which rejects tampered cookies.
 */
function roleFromCookie(raw: string): Role | null {
  try {
    const body = raw.slice(0, raw.lastIndexOf("."));
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return json?.role ?? null;
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
    const role = roleFromCookie(sessionRaw!);
    if (role && !canAccess(role, pathname)) {
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
