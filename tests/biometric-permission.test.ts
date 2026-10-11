import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { allowedNavPaths, canAccess, canUseBiometricDevice, hasPermission, isSelfService } from "@/lib/permissions";
import { canLinkDeviceEmployee } from "@/lib/scope";
import type { User } from "@/lib/types";

/**
 * The "جهاز البصمة" permission: the /biometric-device page and its actions are open to an admin or an account
 * granted it — nobody else — and linking an employee to a device user also needs that employee to be inside the
 * account's department scope. Same shape as employee-files-scope: a role matrix, then the per-record check against
 * the sample-seeded database (skipped when unreachable).
 */
const prisma = new PrismaClient();

let sampleLoaded = false;
let deptA = "";
let empInDeptA = "";
let empInOtherDept = "";
try {
  const a = await prisma.employee.findFirst({ where: { deletedAt: null } });
  const b = a ? await prisma.employee.findFirst({ where: { departmentId: { not: a.departmentId }, deletedAt: null } }) : null;
  if (a && b) {
    deptA = a.departmentId;
    empInDeptA = a.id;
    empInOtherDept = b.id;
    sampleLoaded = (await prisma.employee.count()) >= 10;
  }
} catch {
  sampleLoaded = false;
}

afterAll(async () => {
  await prisma.$disconnect();
});

const user = (over: Partial<User>): User => ({
  id: "U", name: "U", email: "u@x.com", role: "employee", permissions: [], ...over,
});

describe("the page and its actions", () => {
  it("an admin always has it", () => {
    const admin = user({ role: "admin" });
    expect(canUseBiometricDevice(admin)).toBe(true);
    expect(canAccess(admin, "/biometric-device")).toBe(true);
    expect(canAccess(admin, "/biometric-device/users/12")).toBe(true);
  });

  it("an account granted it can open the page, the user pages under it, and sees the link", () => {
    for (const role of ["hr", "supervisor", "staff"] as const) {
      const granted = user({ role, permissions: ["biometric_device"] });
      expect(canUseBiometricDevice(granted)).toBe(true);
      expect(canAccess(granted, "/biometric-device")).toBe(true);
      expect(canAccess(granted, "/biometric-device/users/12")).toBe(true);
      expect(allowedNavPaths(granted)).toContain("/biometric-device");
    }
  });

  it("an account with other permissions but not this one can't reach it", () => {
    for (const role of ["hr", "supervisor", "staff"] as const) {
      const other = user({ role, permissions: ["employees", "attendance", "settings"] });
      expect(canUseBiometricDevice(other)).toBe(false);
      expect(canAccess(other, "/biometric-device")).toBe(false);
      expect(canAccess(other, "/biometric-device/users/12")).toBe(false);
      expect(allowedNavPaths(other)).not.toContain("/biometric-device");
    }
  });

  it("an account with no permissions at all, and an employee, are self-service and can't", () => {
    for (const role of ["hr", "supervisor", "staff"] as const) {
      const empty = user({ role, permissions: [] });
      expect(isSelfService(empty)).toBe(true);
      expect(canUseBiometricDevice(empty)).toBe(false);
      expect(canAccess(empty, "/biometric-device")).toBe(false);
    }
    // an employee ignores the permissions list entirely, even if it somehow names this one
    const employee = user({ role: "employee", permissions: ["biometric_device"] });
    expect(canUseBiometricDevice(employee)).toBe(false);
    expect(canAccess(employee, "/biometric-device")).toBe(false);
  });

  it("the permission is a normal grantable key; /users, /permissions and /change-requests stay admin only", () => {
    const granted = user({ role: "staff", permissions: ["biometric_device"] });
    expect(hasPermission(granted, "biometric_device")).toBe(true);
    for (const path of ["/users", "/permissions", "/change-requests"]) {
      expect(canAccess(user({ role: "admin" }), path)).toBe(true);
      expect(canAccess(granted, path)).toBe(false);
    }
  });
});

describe.skipIf(!sampleLoaded)("linking an employee to a device user respects the department scope", () => {
  it("an admin can link anyone", async () => {
    expect(await canLinkDeviceEmployee(user({ role: "admin" }), empInOtherDept)).toBe(true);
  });

  it("an account with the permission, scoped to a department, links that department only", async () => {
    const supervisor = user({ role: "supervisor", permissions: ["biometric_device"], departmentIds: [deptA] });
    expect(await canLinkDeviceEmployee(supervisor, empInDeptA)).toBe(true);
    expect(await canLinkDeviceEmployee(supervisor, empInOtherDept)).toBe(false);
  });

  it("an account with the permission and no department limit is company-wide", async () => {
    const wide = user({ role: "supervisor", permissions: ["biometric_device"] });
    expect(await canLinkDeviceEmployee(wide, empInDeptA)).toBe(true);
    expect(await canLinkDeviceEmployee(wide, empInOtherDept)).toBe(true);
  });

  it("an account without the permission can't link anyone, even inside its own department", async () => {
    const noGrant = user({ role: "supervisor", permissions: ["employees"], departmentIds: [deptA] });
    expect(await canLinkDeviceEmployee(noGrant, empInDeptA)).toBe(false);
  });
});
