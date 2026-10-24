import { Role, User } from "@/lib/types";

/**
 * Grantable page permissions. admin/employee never consult this list (see
 * `hasPermission`); it only governs hr/supervisor "اداري" accounts, which are
 * empty by default and populated one-by-one from /permissions by an admin.
 */
export const PERMISSION_DEFS = [
  { key: "employees", path: "/employees" },
  { key: "departments", path: "/departments" },
  { key: "shifts", path: "/shifts" },
  { key: "attendance", path: "/attendance" },
  { key: "leaves", path: "/leaves" },
  { key: "overtime", path: "/overtime" },
  { key: "deductions", path: "/deductions" },
  { key: "payroll", path: "/payroll" },
  { key: "reports", path: "/reports" },
  { key: "workforce_cost", path: "/workforce-cost" },
  { key: "audit_log", path: "/audit-log" },
  { key: "settings", path: "/settings" },
  { key: "biometric_device", path: "/biometric-device" },
] as const;

export type PermissionKey = (typeof PERMISSION_DEFS)[number]["key"];
export const PERMISSION_KEYS: PermissionKey[] = PERMISSION_DEFS.map((p) => p.key);

// /users, /permissions and /change-requests are never grantable — admin only (HR approving leaves or deductions
// also opens /change-requests, for those requests only — see allowedNavPaths). (/biometric-device is a
// grantable page like the rest: it comes in through PERMISSION_DEFS.)
const ADMIN_NAV = [
  "/dashboard", ...PERMISSION_DEFS.map((p) => p.path),
  "/users", "/permissions", "/change-requests",
];
const EMPLOYEE_NAV = ["/dashboard", "/attendance", "/leaves", "/payroll"];

type SessionLike = Pick<User, "role" | "permissions">;

/**
 * Self-service accounts see only their own data (own attendance, leaves,
 * payslip) and can file a leave request: every `employee` account, plus any
 * hr/supervisor/staff account the admin hasn't granted a single permission yet.
 * The moment an admin grants something on /permissions, the account leaves
 * self-service and is governed by its grants (and department scope) instead.
 */
export function isSelfService(user: SessionLike): boolean {
  if (user.role === "admin") return false;
  if (user.role === "employee") return true;
  return !Array.isArray(user.permissions) || user.permissions.length === 0;
}

/** Does this user hold the given granular permission? admin: always. self-service: never. */
export function hasPermission(user: SessionLike, key: PermissionKey): boolean {
  if (user.role === "admin") return true;
  if (isSelfService(user)) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

export function allowedNavPaths(user: SessionLike): string[] {
  if (user.role === "admin") return ADMIN_NAV;
  if (isSelfService(user)) return EMPLOYEE_NAV;
  const granted = PERMISSION_DEFS.filter((p) => hasPermission(user, p.key)).map((p) => p.path);
  // HR approving leaves or deductions reviews those requests on /change-requests (only those — see the page)
  return ["/dashboard", ...granted, ...(reviewsRequests(user) ? ["/change-requests"] : [])];
}

export function canAccess(user: SessionLike, path: string): boolean {
  return allowedNavPaths(user).some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The page permission every gated write needs, by its action key's prefix: an account can only change — or even
 * ask to change — what sits on a page it was granted. Work schedules check their own (settings vs /shifts).
 */
const ACTION_PERMISSIONS: Record<string, PermissionKey> = {
  employees: "employees",
  departments: "departments",
  shifts: "shifts",
  attendance: "attendance",
  leaves: "leaves",
  overtime: "overtime",
  deductions: "deductions",
  allowances: "deductions",
  payroll: "payroll",
  settings: "settings",
  biometric: "biometric_device",
};

export function actionPermission(actionKey: string): PermissionKey | null {
  return ACTION_PERMISSIONS[actionKey.split(".")[0]] ?? null;
}

/**
 * Requests only the system admin or HR may approve — a leave or excuse decision, and a deduction (penalty,
 * advance…) — with the permission each needs. Nobody else's request skips that approval, "direct edit" included.
 */
export const HR_APPROVALS: Record<string, PermissionKey> = {
  "leaves.decide": "leaves",
  "deductions.create": "deductions",
};

/** The system admin, or an HR ("الموارد البشرية") account holding that page's permission. */
export function canApprove(user: SessionLike, permission: PermissionKey): boolean {
  if (user.role === "admin") return true;
  return user.role === "hr" && hasPermission(user, permission);
}

/** Whether `user` may approve / reject a pending change request with this action key: the admin any; HR the HR_APPROVALS ones. */
export function canReviewRequest(user: SessionLike, actionKey: string): boolean {
  if (user.role === "admin") return true;
  const permission = HR_APPROVALS[actionKey];
  return Boolean(permission && canApprove(user, permission));
}

/** Whether `user` reviews any requests at all (the admin, or HR approving leaves or deductions). */
export function reviewsRequests(user: SessionLike): boolean {
  return Object.values(HR_APPROVALS).some((p) => canApprove(user, p));
}

/** Only a true admin manages logins and permission grants — never delegable. */
export function canManageUsers(role: Role): boolean {
  return role === "admin";
}

export function canManagePermissions(role: Role): boolean {
  return role === "admin";
}

/** The fingerprint-device page and its actions: admin, or an account granted "جهاز البصمة". */
export function canUseBiometricDevice(user: SessionLike): boolean {
  return hasPermission(user, "biometric_device");
}

/** Roles whose access is governed by the per-user permissions checklist. */
export function isStaffRole(role: Role): boolean {
  return role === "hr" || role === "supervisor" || role === "staff";
}

/**
 * Upload / replace / delete an employee's documents and signed acknowledgments.
 * Deliberately narrower than the general "employees" permission: never
 * delegable to a supervisor, and an hr-tagged "اداري" account still needs the
 * "employees" grant itself (an empty-permissions account holds no access by
 * role alone).
 */
export function canManageEmployeeFiles(user: SessionLike): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "hr") return false;
  return hasPermission(user, "employees");
}

/**
 * The virtual assistant reads whole employee files (national ID, salary, attendance), so it needs the same
 * grant as the employees module, and it only ever sees the records that grant's department scope allows.
 */
export function canUseAssistant(user: SessionLike): boolean {
  return hasPermission(user, "employees");
}
