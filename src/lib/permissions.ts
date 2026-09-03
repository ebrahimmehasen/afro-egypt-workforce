import { Role } from "@/lib/types";

const NAV_BY_ROLE: Record<Role, string[]> = {
  admin: [
    "/dashboard", "/employees", "/departments", "/shifts", "/attendance", "/leaves",
    "/overtime", "/deductions", "/payroll", "/reports", "/workforce-cost", "/audit-log", "/users", "/settings",
  ],
  hr: [
    "/dashboard", "/employees", "/departments", "/shifts", "/attendance", "/leaves",
    "/overtime", "/deductions", "/payroll", "/reports", "/workforce-cost", "/audit-log",
  ],
  supervisor: [
    "/dashboard", "/employees", "/attendance", "/leaves", "/overtime", "/reports",
  ],
  employee: ["/dashboard", "/attendance", "/leaves", "/payroll"],
};

export function allowedNavPaths(role: Role): string[] {
  return NAV_BY_ROLE[role];
}

export function canAccess(role: Role, path: string): boolean {
  return allowedNavPaths(role).some((p) => path === p || path.startsWith(`${p}/`));
}

export function canApprove(role: Role): boolean {
  return role === "admin" || role === "hr" || role === "supervisor";
}

export function canEditPayroll(role: Role): boolean {
  return role === "admin" || role === "hr";
}

export function canManageSettings(role: Role): boolean {
  return role === "admin";
}

export function canManageUsers(role: Role): boolean {
  return role === "admin";
}

export function canCorrectAttendance(role: Role): boolean {
  return role === "admin" || role === "hr";
}
