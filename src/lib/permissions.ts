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
] as const;

export type PermissionKey = (typeof PERMISSION_DEFS)[number]["key"];
export const PERMISSION_KEYS: PermissionKey[] = PERMISSION_DEFS.map((p) => p.key);

// /biometric-device is never grantable — same tier as /users and /permissions.
const ADMIN_NAV = [
  "/dashboard", ...PERMISSION_DEFS.map((p) => p.path),
  "/users", "/permissions", "/change-requests", "/biometric-device",
];
const EMPLOYEE_NAV = ["/dashboard", "/attendance", "/leaves", "/payroll"];

type SessionLike = Pick<User, "role" | "permissions">;

/** Does this user hold the given granular permission? admin: always. employee: never. */
export function hasPermission(user: SessionLike, key: PermissionKey): boolean {
  if (user.role === "admin") return true;
  if (user.role === "employee") return false;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

export function allowedNavPaths(user: SessionLike): string[] {
  if (user.role === "admin") return ADMIN_NAV;
  if (user.role === "employee") return EMPLOYEE_NAV;
  const granted = PERMISSION_DEFS.filter((p) => hasPermission(user, p.key)).map((p) => p.path);
  return ["/dashboard", ...granted];
}

export function canAccess(user: SessionLike, path: string): boolean {
  return allowedNavPaths(user).some((p) => path === p || path.startsWith(`${p}/`));
}

/** Only a true admin manages logins and permission grants — never delegable. */
export function canManageUsers(role: Role): boolean {
  return role === "admin";
}

export function canManagePermissions(role: Role): boolean {
  return role === "admin";
}

export function canManageBiometricDevice(role: Role): boolean {
  return role === "admin";
}

/** hr/supervisor with no grants yet, and not the admin role itself. */
export function isPendingStaffAccount(user: SessionLike): boolean {
  return (user.role === "hr" || user.role === "supervisor") && (!Array.isArray(user.permissions) || user.permissions.length === 0);
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
