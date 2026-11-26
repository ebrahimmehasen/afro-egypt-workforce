/**
 * The pages anyone may open without logging in: the login page, and the public job-application form. Nothing else.
 * (The one public endpoint, POST /api/apply, lives under /api, which the middleware never runs on; every other /api route
 * carries its own session check, see tests/public-surface.test.ts.)
 */
const PUBLIC_EXACT = ["/apply"];
const PUBLIC_PREFIXES = ["/login"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.some((p) => pathname === p || pathname === `${p}/`) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}
