import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { employeesInScope, rowsInScope, viewerScope } from "@/lib/scope";
import type { Employee, User } from "@/lib/types";

/**
 * Deductions & penalties (and the allowances tab): an account granted "deductions" but limited to departments
 * sees — and acts on — those departments' employees only. The page narrows with viewerScope; the actions check
 * the employee too, so a request sent outside the page is refused as well.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/attendance-effects", () => ({ scheduleAttendanceEffects: () => {} }));

const { deleteDeduction, updateDeduction } = await import("@/lib/actions/deductions");
const { createAllowance, deleteAllowance } = await import("@/lib/actions/allowances");

const prisma = new PrismaClient();
let sampleDb = false;
let roster: Employee[] = [];
let inDept = { id: "", departmentId: "" };
let otherDept = { id: "", departmentId: "" };
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
  if (sampleDb) {
    const seeded = { deletedAt: null, id: { startsWith: "EMP-" } };
    roster = (await prisma.employee.findMany({ where: seeded, select: { id: true, departmentId: true } })) as unknown as Employee[];
    inDept = await prisma.employee.findFirstOrThrow({ where: seeded, orderBy: { id: "asc" }, select: { id: true, departmentId: true } });
    otherDept = await prisma.employee.findFirstOrThrow({ where: { ...seeded, departmentId: { not: inDept.departmentId } }, orderBy: { id: "asc" }, select: { id: true, departmentId: true } });
  }
} catch {
  sampleDb = false;
}
const MARK = "اختبار نطاق الخصومات";
const supervisor = (): User => ({ id: "U-sup", name: "deductions-scope-test", email: "s@x", role: "supervisor", permissions: ["deductions"], departmentIds: [inDept.departmentId] });

const cleanUp = async () => {
  await prisma.deduction.deleteMany({ where: { reason: MARK } });
  await prisma.allowance.deleteMany({ where: { notes: MARK } });
  await prisma.changeRequest.deleteMany({ where: { requestedBy: "deductions-scope-test" } });
};
if (sampleDb) await cleanUp(); // fixed ids below: clear anything a crashed run left
afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("deductions and allowances stay inside the account's departments", () => {
  it("the page shows only that department's employees and their rows", () => {
    const scope = viewerScope(supervisor(), roster);
    const shown = employeesInScope(scope, roster);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((e) => e.departmentId === inDept.departmentId)).toBe(true);
    const rows = rowsInScope(scope, [{ employeeId: inDept.id }, { employeeId: otherDept.id }]);
    expect(rows).toEqual([{ employeeId: inDept.id }]);
  });

  it("another department's deduction can't be changed or deleted, nor an allowance added or deleted there", async () => {
    const d = await prisma.deduction.create({ data: { id: "DED-ZZSCOPE-1", employeeId: otherDept.id, type: "penalty", amount: 100, date: new Date("2030-05-04"), reason: MARK } });
    const a = await prisma.allowance.create({ data: { id: "ALW-ZZSCOPE-1", employeeId: otherDept.id, type: "bonus", amount: 100, monthly: false, effectiveYear: 2030, effectiveMonth: 5, notes: MARK } });
    session = supervisor();

    expect(await deleteDeduction(d.id)).toHaveProperty("error");
    const f = new FormData();
    for (const [k, v] of Object.entries({ id: d.id, type: "penalty", amount: "50", date: "2030-05-04", reason: MARK })) f.set(k, v);
    expect(await updateDeduction({}, f)).toHaveProperty("error");
    expect(await deleteAllowance(a.id)).toHaveProperty("error");
    const add = new FormData();
    for (const [k, v] of Object.entries({ employeeId: otherDept.id, type: "bonus", amount: "100", monthly: "false", effectiveYear: "2030", effectiveMonth: "5", notes: MARK })) add.set(k, v);
    expect(await createAllowance({}, add)).toHaveProperty("error");

    // nothing changed and nothing was queued
    expect(await prisma.deduction.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ amount: 100 });
    expect(await prisma.allowance.findUnique({ where: { id: a.id } })).toBeTruthy();
    expect(await prisma.changeRequest.count({ where: { requestedBy: "deductions-scope-test" } })).toBe(0);
  });

  it("their own department's deduction can be asked to be deleted (it waits for approval)", async () => {
    const d = await prisma.deduction.create({ data: { id: "DED-ZZSCOPE-2", employeeId: inDept.id, type: "penalty", amount: 100, date: new Date("2030-05-04"), reason: MARK } });
    session = supervisor();
    expect(await deleteDeduction(d.id)).toMatchObject({ success: true });
    expect(await prisma.changeRequest.count({ where: { requestedBy: "deductions-scope-test", actionKey: "deductions.delete", status: "pending" } })).toBe(1);
  });
});
