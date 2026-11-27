// A hostname like jobs-afroegypt.404legend.space must show ONLY the public job-application page: everything else on
// it answers a plain 404, so a visitor there can never tell an HR system exists behind it. Pure and host-driven: the
// decision comes from the Host header alone (never x-forwarded-host, which a client can set to anything) and an
// explicit allow-list, so adding a path here is a deliberate, reviewable change, not an accident of some other check.

/** Used only when APPLY_ONLY_HOSTS is unset or empty. */
export const DEFAULT_APPLY_ONLY_HOSTS = ["jobs-afroegypt.404legend.space"];

function gatedHosts(): string[] {
  const raw = process.env.APPLY_ONLY_HOSTS?.trim();
  if (!raw) return DEFAULT_APPLY_ONLY_HOSTS;
  const hosts = raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return hosts.length > 0 ? hosts : DEFAULT_APPLY_ONLY_HOSTS;
}

/** Host header, lowercased, port stripped. Exact match only: no wildcards, no suffix match (a lookalike like
 * "jobs-afroegypt.404legend.space.evil.com" must never match). */
export function isApplyOnlyHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return gatedHosts().includes(host);
}

const STATIC_FILE_PREFIXES = ["/_next/static/", "/brand/"];
const EXACT_ALLOWED_GET = ["/apply", "/apply/", "/_next/image", "/favicon.ico"];

/**
 * Whether a request on an already-confirmed gated host may proceed. Everything not explicitly allowed here must be
 * answered with a 404 by the caller. A Next-Action header (server actions) is never allowed: the apply page only
 * ever calls fetch("/api/apply", ...), so no legitimate request on this host ever carries one.
 */
export function isAllowedOnApplyHost(method: string, pathname: string, headers: Pick<Headers, "get">): boolean {
  const m = method.toUpperCase();
  if (headers.get("next-action")) return false;
  if (!["GET", "HEAD", "POST", "OPTIONS"].includes(m)) return false;

  if (m === "POST") return pathname === "/api/apply";
  if (m === "OPTIONS") return pathname === "/api/apply";

  // GET or HEAD from here on
  if (EXACT_ALLOWED_GET.includes(pathname)) return true;
  return STATIC_FILE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
