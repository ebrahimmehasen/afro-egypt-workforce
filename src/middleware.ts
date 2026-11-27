import { NextRequest, NextResponse } from "next/server";
import { canAccess } from "@/lib/permissions";
import { isPublicPath } from "@/lib/public-paths";
import { isAllowedOnApplyHost, isApplyOnlyHost } from "@/lib/apply-host-gate";
import { Role } from "@/lib/types";

const SESSION_COOKIE = "afro_egypt_session";
const ALWAYS_ALLOWED = ["/dashboard", "/payslip", "/leave-paper"];
// The set the matcher below used to exclude outright. Kept here, verbatim, so a request on any OTHER host still
// skips the gate exactly as before — this middleware never ran on these paths until the apply-only gate needed to.
const MATCHER_EXCLUDED = (pathname: string) =>
  pathname.startsWith("/api") || pathname.startsWith("/_next/static") || pathname.startsWith("/_next/image") || pathname.startsWith("/brand") || pathname === "/favicon.ico";

const notFound = () => new NextResponse(null, { status: 404 });

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
};

function withApplyHostSecurityHeaders(res: NextResponse, pathname: string): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(key, value);
  if (pathname === "/api/apply") res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Reads role + permissions out of the signed session cookie WITHOUT verifying
 * the signature — this is only a coarse UX redirect. Real enforcement is
 * `requireAccess()` in each (app) page (see src/lib/auth.ts), which verifies
 * the session signature and checks role/permissions-vs-path itself. Employee
 * files (/api/employees/[id]/documents|acknowledgments) are under /api, so
 * this middleware never runs on them at all — they carry their own session +
 * per-record scope check (canViewEmployee).
 */
function userFromCookie(raw: string): { role: Role; permissions: string[]; departmentIds: string[] } | null {
  try {
    const body = raw.slice(0, raw.lastIndexOf("."));
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!json?.role) return null;
    return { role: json.role, permissions: Array.isArray(json.permissions) ? json.permissions : [], departmentIds: Array.isArray(json.departmentIds) ? json.departmentIds : [] };
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isApplyOnlyHost(request.headers.get("host"))) {
    if (!isAllowedOnApplyHost(request.method, pathname, request.headers)) return notFound();
    return withApplyHostSecurityHeaders(NextResponse.next(), pathname);
  }

  // every other host: unchanged behaviour, including paths the matcher used to exclude before the gate above needed
  // to see them too
  if (MATCHER_EXCLUDED(pathname)) return NextResponse.next();

  const sessionRaw = request.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = Boolean(sessionRaw);

  const isPublic = isPublicPath(pathname);

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
  // Used to exclude /api, /_next/static, /_next/image, /brand and favicon.ico outright. The apply-only host gate
  // above must see those paths too (that is exactly what it exists to police), so the middleware now runs on
  // everything and reproduces that same exclusion itself (MATCHER_EXCLUDED) for every host other than a gated one.
  matcher: ["/(.*)"],
};
