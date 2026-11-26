// The assistant may point to a page ("open the deductions page") as a link in its answer. A link is only
// followed when it is a path inside this app, to a page that exists; anything else shows as plain text.

/** The top-level pages of the app (the folders of src/app/(app)); a test keeps this in step with them. */
export const ASSISTANT_LINK_ROOTS = [
  "attendance",
  "audit-log",
  "biometric-device",
  "case-proof",
  "change-requests",
  "dashboard",
  "deductions",
  "departments",
  "employees",
  "leaves",
  "missions",
  "overtime",
  "payroll",
  "permissions",
  "reports",
  "requests",
  "settings",
  "shifts",
  "users",
  "workforce-cost",
] as const;

const PATH = /^\/[A-Za-z0-9_\-/]*(\?[A-Za-z0-9_\-=&%.]*)?$/;

/** The one file the assistant may link to: the overtime statement workbook (same route and permission check as the page's button). */
export const ASSISTANT_DOWNLOAD_PATH = "/api/overtime/statement/export";

const DOWNLOAD_PARAMS: Record<string, RegExp> = { month: /^\d{4}-\d{2}$/, from: /^\d{4}-\d{2}-\d{2}$/, to: /^\d{4}-\d{2}-\d{2}$/ };

/** True for a link that downloads a file instead of opening a page: that one path, with only a month or a from/to day. */
export function isDownloadHref(href: string): boolean {
  const [path, query = "", ...rest] = href.trim().split("?");
  if (path !== ASSISTANT_DOWNLOAD_PATH || rest.length > 0) return false;
  const pairs = query === "" ? [] : query.split("&");
  return pairs.length <= 3 && pairs.every((p) => {
    const [key, value = "", ...extra] = p.split("=");
    return extra.length === 0 && DOWNLOAD_PARAMS[key]?.test(value) === true;
  });
}

/** The href if it is a safe in-app path to a known page, otherwise null. */
export function safeInternalHref(href: string): string | null {
  const h = href.trim();
  if (isDownloadHref(h)) return h;
  if (h.length > 200 || h.startsWith("//") || !PATH.test(h)) return null;
  const root = h.slice(1).split(/[/?]/)[0];
  return (ASSISTANT_LINK_ROOTS as readonly string[]).includes(root) ? h : null;
}
