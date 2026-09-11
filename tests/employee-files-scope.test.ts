import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { canViewEmployee } from "@/lib/scope";
import type { User } from "@/lib/types";

/**
 * canViewEmployee gates GET /api/employees/:id/documents|acknowledgments —
 * the route that serves uploaded ID cards, birth certificates, etc. Must
 * follow the exact same rule as viewerScope, just for one record. Runs
 * against the sample-seeded database; skips automatically when unreachable.
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
  id: "U", name: "U", email: "u@x.com", role: "employee", ...over,
});

describe.skipIf(!sampleLoaded)("canViewEmployee", () => {
  it("admin and hr can view anyone", async () => {
    expect(await canViewEmployee(user({ role: "admin" }), empInOtherDept)).toBe(true);
    expect(await canViewEmployee(user({ role: "hr" }), empInOtherDept)).toBe(true);
  });

  it("an employee can view only themselves", async () => {
    expect(await canViewEmployee(user({ role: "employee", employeeId: empInDeptA }), empInDeptA)).toBe(true);
    expect(await canViewEmployee(user({ role: "employee", employeeId: empInDeptA }), empInOtherDept)).toBe(false);
  });

  it("a supervisor can view their own department but not another", async () => {
    const supervisor = user({ role: "supervisor", departmentId: deptA });
    expect(await canViewEmployee(supervisor, empInDeptA)).toBe(true);
    expect(await canViewEmployee(supervisor, empInOtherDept)).toBe(false);
  });

  it("a supervisor with no department, or an unrecognized role, sees nothing", async () => {
    expect(await canViewEmployee(user({ role: "supervisor" }), empInDeptA)).toBe(false);
  });
});
