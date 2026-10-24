import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";

/**
 * Moving an employee to another department gives them that department's next number (employee-number.ts),
 * in the same transaction as the edit and its audit row; anything else keeps the number. Runs the real edit
 * path (applyUpdateEmployee, gate, approveChangeRequest) against the sample-seeded dev database, on a temporary
 * employee in two temporary departments that are removed afterwards. Skips itself when the database is
 * unreachable — and on any database that isn't the sample one, so it never writes to real data.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/pay-refresh", () => ({ refreshPayCalculations: () => {} }));

const { applyUpdateEmployee, updateEmployee } = await import("@/lib/actions/employees");
const { approveChangeRequest } = await import("@/lib/actions/change-requests");

const prisma = new PrismaClient();
let sampleDb = false;
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
} catch {
  sampleDb = false;
}

// department names outside the code table, so their codes are just the name: ZZTA / ZZTB
const DEPT_A = "ZZTA";
const DEPT_B = "ZZTB";
const ACTOR = "employee-number-test";
const ids: string[] = [];
let deptA = "";
let deptB = "";
let shiftId = "";

async function cleanUp() {
  const deps = await prisma.department.findMany({ where: { name: { in: [DEPT_A, DEPT_B] } }, select: { id: true } });
  await prisma.employee.deleteMany({ where: { departmentId: { in: deps.map((d) => d.id) } } });
  await prisma.department.deleteMany({ where: { id: { in: deps.map((d) => d.id) } } });
  await prisma.departmentNumberSequence.deleteMany({ where: { code: { in: [DEPT_A, DEPT_B] } } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  await prisma.changeRequest.deleteMany({ where: { requestedBy: ACTOR } });
}

const seqOf = async (code: string) => (await prisma.departmentNumberSequence.findUnique({ where: { code } }))?.lastValue ?? 0;

async function makeEmployee(number: string, departmentId: string, status: "active" | "terminated" = "active") {
  const e = await prisma.employee.create({
    data: {
      // an id that sorts after the seeded "EMP-…" ones, so a test running in parallel that takes "the first
      // active employee" never picks this temporary one
      id: `ZZ-${number}`,
      employeeNumber: number,
      name: `اختبار ${number}`,
      departmentId,
      jobTitle: "x",
      hireDate: new Date("2024-01-01"),
      shiftId,
      basicSalary: 6000,
      status,
    },
  });
  ids.push(e.id);
  return e;
}

/** The edit as the form sends it: the employee's own values, with `over` changed. */
async function payloadFor(id: string, over: Record<string, unknown> = {}) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
  return {
    id,
    name: e.name,
    departmentId: e.departmentId,
    jobTitle: e.jobTitle,
    hireDate: e.hireDate.toISOString().slice(0, 10),
    shiftId: e.shiftId,
    salaryType: e.salaryType,
    basicSalary: e.basicSalary,
    dailyWorkingHours: e.dailyWorkingHours,
    overtimeEligible: e.overtimeEligible,
    allowances: e.allowancesTotal,
    status: e.status,
    phone: null,
    address: null,
    qualification: null,
    militaryStatus: null,
    nationalId: null,
    isDriver: false,
    ...over,
  };
}

const numberOf = async (id: string) => (await prisma.employee.findUniqueOrThrow({ where: { id } })).employeeNumber;

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("employee number follows the department", () => {
  beforeAll(async () => {
    await cleanUp();
    shiftId = (await prisma.shift.findFirstOrThrow()).id;
    // created already soft-deleted: the number logic reads them by id all the same, and the sample-seed test
    // (which counts the live departments, in parallel with this file) never sees them
    deptA = (await prisma.department.create({ data: { name: DEPT_A, deletedAt: new Date() } })).id;
    deptB = (await prisma.department.create({ data: { name: DEPT_B, deletedAt: new Date() } })).id;
  });
  beforeEach(() => {
    session = { id: "U-admin", name: ACTOR, email: "a@x", role: "admin", permissions: [] };
  });

  it("a move gives the new department's code and next number, claims it once, and logs both changes on one audit row", async () => {
    const e = await makeEmployee("ZZTA-001", deptA);
    const before = await seqOf(DEPT_B);
    const result = await applyUpdateEmployee((await payloadFor(e.id, { departmentId: deptB })) as never, ACTOR);
    const expected = `ZZTB-${String(before + 1).padStart(3, "0")}`;
    expect(result).toMatchObject({ success: true, employeeNumber: expected });
    expect(await numberOf(e.id)).toBe(expected);
    expect(await seqOf(DEPT_B)).toBe(before + 1);
    const audit = await prisma.auditLogEntry.findFirstOrThrow({ where: { userName: ACTOR }, orderBy: { timestamp: "desc" } });
    expect(audit.oldValue).toContain(`${DEPT_A} (ZZTA-001)`);
    expect(audit.newValue).toContain(`${DEPT_B} (${expected})`);
  });

  it("the old number is never handed out again: the sequence only goes forward", async () => {
    const e = await makeEmployee("ZZTA-050", deptA);
    await applyUpdateEmployee((await payloadFor(e.id, { departmentId: deptB })) as never, ACTOR);
    // back to A: a new A number, not the one it gave up
    const backA = await seqOf(DEPT_A);
    await applyUpdateEmployee((await payloadFor(e.id, { departmentId: deptA })) as never, ACTOR);
    const now = await numberOf(e.id);
    expect(now).toBe(`ZZTA-${String(backA + 1).padStart(3, "0")}`);
    expect(now).not.toBe("ZZTA-050");
    expect(await seqOf(DEPT_A)).toBe(backA + 1);
  });

  it("saving the same department, or changing another field, keeps the number and claims nothing", async () => {
    const e = await makeEmployee("ZZTA-100", deptA);
    const seqA = await seqOf(DEPT_A);
    const seqB = await seqOf(DEPT_B);
    const same = await applyUpdateEmployee((await payloadFor(e.id)) as never, ACTOR);
    const other = await applyUpdateEmployee((await payloadFor(e.id, { jobTitle: "y", basicSalary: 7000 })) as never, ACTOR);
    expect(same).not.toHaveProperty("employeeNumber");
    expect(other).not.toHaveProperty("employeeNumber");
    expect(await numberOf(e.id)).toBe("ZZTA-100");
    expect([await seqOf(DEPT_A), await seqOf(DEPT_B)]).toEqual([seqA, seqB]);
  });

  it("a terminated employee who moves gets a new number too", async () => {
    const e = await makeEmployee("ZZTA-200", deptA, "terminated");
    await applyUpdateEmployee((await payloadFor(e.id, { departmentId: deptB })) as never, ACTOR);
    expect(await numberOf(e.id)).toMatch(/^ZZTB-\d{3}$/);
  });

  it("a request waiting for approval changes nothing; the number is claimed when the admin approves", async () => {
    const e = await makeEmployee("ZZTA-300", deptA);
    // an "اداري" account without direct edit: its edit waits for the admin
    session = { id: "U-staff-no-direct", name: ACTOR, email: "s@x", role: "staff", permissions: ["employees"] };
    const form = new FormData();
    for (const [k, v] of Object.entries(await payloadFor(e.id, { departmentId: deptB, phone: "0100000000", address: "عنوان", qualification: "مؤهل", militaryStatus: "completed", nationalId: "29001010100099", gender: "male" }))) {
      if (v !== null && v !== false) form.set(k, String(v));
    }
    const seqB = await seqOf(DEPT_B);
    const queued = await updateEmployee({}, form);
    expect(queued).toMatchObject({ success: true });
    expect(queued).not.toHaveProperty("employeeNumber");
    expect(await numberOf(e.id)).toBe("ZZTA-300");
    expect(await seqOf(DEPT_B)).toBe(seqB);

    const request = await prisma.changeRequest.findFirstOrThrow({ where: { requestedBy: ACTOR, targetId: e.id, status: "pending" } });
    session = { id: "U-admin", name: "admin-approver", email: "a@x", role: "admin", permissions: [] };
    expect(await approveChangeRequest(request.id)).toMatchObject({ success: true });
    expect(await numberOf(e.id)).toBe(`ZZTB-${String(seqB + 1).padStart(3, "0")}`);
    await prisma.auditLogEntry.deleteMany({ where: { userName: "admin-approver" } });
  });

  it("moves at the same moment never share a number, and a number someone already holds is skipped", async () => {
    // someone already holds B's next number (set by hand, ahead of the sequence)
    const next = `ZZTB-${String((await seqOf(DEPT_B)) + 1).padStart(3, "0")}`;
    await makeEmployee(next, deptB);
    const movers = [await makeEmployee("ZZTA-400", deptA), await makeEmployee("ZZTA-401", deptA), await makeEmployee("ZZTA-402", deptA)];
    const results = await Promise.all(movers.map(async (m) => applyUpdateEmployee((await payloadFor(m.id, { departmentId: deptB })) as never, ACTOR)));
    expect(results.every((r) => r.success)).toBe(true);
    const numbers = await Promise.all(movers.map((m) => numberOf(m.id)));
    expect(new Set(numbers).size).toBe(3);
    expect(numbers).not.toContain(next);
    expect(numbers.every((n) => /^ZZTB-\d{3}$/.test(n))).toBe(true);
  });
});
