// The assistant may point to a page ("open the deductions page") as a link in its answer. A link is only
// followed when it is a path inside this app, to a page that exists; anything else shows as plain text.

/** The top-level pages of the app (the folders of src/app/(app)); a test keeps this in step with them. */
export const ASSISTANT_LINK_ROOTS = [
  "attendance",
  "audit-log",
  "biometric-device",
  "change-requests",
  "dashboard",
  "deductions",
  "departments",
  "employees",
  "leaves",
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

/** The href if it is a safe in-app path to a known page, otherwise null. */
export function safeInternalHref(href: string): string | null {
  const h = href.trim();
  if (h.length > 200 || h.startsWith("//") || !PATH.test(h)) return null;
  const root = h.slice(1).split(/[/?]/)[0];
  return (ASSISTANT_LINK_ROOTS as readonly string[]).includes(root) ? h : null;
}
