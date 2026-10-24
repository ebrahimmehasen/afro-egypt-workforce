import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { actionPermission, allowedNavPaths, canAccess, canApprove, canReviewRequest, reviewsRequests } from "@/lib/permissions";
import type { User } from "@/lib/types";

/**
 * 1. An account does only what it was granted: every gated write needs that page's permission — even to ask.
 * 2. A leave / excuse decision and a deduction (penalty, advance…) are approved by the system admin or HR
 *    ("الموارد البشرية" holding that page's permission) only; nobody else's skips it, "direct edit" included.
 */
const user = (over: Partial<User>): User => ({ id: "U", name: "U", email: "u@x", role: "staff", permissions: [], ...over });

describe("which page permission a write needs", () => {
  it("by its action's page", () => {
    expect(actionPermission("deductions.create")).toBe("deductions");
    expect(actionPermission("allowances.create")).toBe("deductions");
    expect(actionPermission("leaves.decide")).toBe("leaves");
    expect(actionPermission("payroll.calculate")).toBe("payroll");
    expect(actionPermission("settings.company")).toBe("settings");
    expect(actionPermission("biometric.link")).toBe("biometric_device");
    expect(actionPermission("workSchedules.save")).toBeNull(); // checks its own (settings vs /shifts)
  });
});

describe("who approves leaves and deductions", () => {
  it("the admin; HR holding the page's permission", () => {
    expect(canApprove(user({ role: "admin" }), "leaves")).toBe(true);
    expect(canApprove(user({ role: "hr", permissions: ["leaves"] }), "leaves")).toBe(true);
    expect(canApprove(user({ role: "hr", permissions: ["deductions"] }), "deductions")).toBe(true);
  });

  it("not HR without that permission, and not a supervisor or staff account even with it", () => {
    expect(canApprove(user({ role: "hr", permissions: ["employees"] }), "leaves")).toBe(false);
    expect(canApprove(user({ role: "supervisor", permissions: ["leaves"] }), "leaves")).toBe(false);
    expect(canApprove(user({ role: "staff", permissions: ["deductions"] }), "deductions")).toBe(false);
  });

  it("HR reviews only those requests on /change-requests; the admin all of them", () => {
    const hr = user({ role: "hr", permissions: ["leaves", "deductions"] });
    expect(canReviewRequest(hr, "deductions.create")).toBe(true);
    expect(canReviewRequest(hr, "leaves.decide")).toBe(true);
    expect(canReviewRequest(hr, "employees.update")).toBe(false);
    expect(canReviewRequest(hr, "deductions.delete")).toBe(false);
    expect(canReviewRequest(user({ role: "admin" }), "employees.update")).toBe(true);
  });

  it("/change-requests opens for an HR approver, not for others", () => {
    expect(canAccess(user({ role: "hr", permissions: ["deductions"] }), "/change-requests")).toBe(true);
    expect(canAccess(user({ role: "supervisor", permissions: ["leaves", "deductions"] }), "/change-requests")).toBe(false);
    expect(canAccess(user({ role: "hr", permissions: ["employees"] }), "/change-requests")).toBe(false);
    expect(reviewsRequests(user({ role: "hr", permissions: ["employees"] }))).toBe(false);
    // nothing else changes for them: still exactly their grants
    expect(allowedNavPaths(user({ role: "hr", permissions: ["deductions"] }))).toEqual(["/dashboard", "/deductions", "/change-requests"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Through the real actions, on the sample-seeded dev database (skipped anywhere else, so never on real data).

let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/attendance-effects", () => ({ scheduleAttendanceEffects: () => {}, runAttendanceEffects: async () => ({ created: 0, updated: 0, removed: 0, periods: 0 }) }));
vi.mock("@/lib/attendance-service", () => ({ recalculateRange: async () => 0, recalculateOpenDays: async () => 0 }));

const { createDeduction } = await import("@/lib/actions/deductions");
const { decideLeave } = await import("@/lib/actions/leaves");
const { approveChangeRequest, rejectChangeRequest } = await import("@/lib/actions/change-requests");

const prisma = new PrismaClient();
let sampleDb = false;
let empA = { id: "", departmentId: "" };
let empB = { id: "", departmentId: "" };
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
  if (sampleDb) {
    // seeded employees only ("EMP-…"), in a fixed order: other test files create and remove temporary ones in parallel
    const seeded = { deletedAt: null, id: { startsWith: "EMP-" } };
    empA = await prisma.employee.findFirstOrThrow({ where: seeded, orderBy: { id: "asc" }, select: { id: true, departmentId: true } });
    empB = await prisma.employee.findFirstOrThrow({ where: { ...seeded, departmentId: { not: empA.departmentId } }, orderBy: { id: "asc" }, select: { id: true, departmentId: true } });
  }
} catch {
  sampleDb = false;
}

const ACTOR = "hr-approvals-test";
const MARK = "اختبار موافقات";
const DIRECT_USER = "U-hr-approvals-direct";

async function cleanUp() {
  await prisma.deduction.deleteMany({ where: { reason: { startsWith: MARK } } });
  await prisma.leave.deleteMany({ where: { reason: { startsWith: MARK } } });
  await prisma.changeRequest.deleteMany({ where: { requestedBy: ACTOR } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: { in: [ACTOR, "approver-hr-test"] } } });
  await prisma.user.deleteMany({ where: { id: DIRECT_USER } });
}
const deductionForm = (employeeId: string, type = "penalty") => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ employeeId, type, amount: "150", date: "2030-01-15", reason: `${MARK} ${type}` })) f.set(k, v);
  return f;
};
const deductionsOf = (employeeId: string) => prisma.deduction.count({ where: { employeeId, reason: { startsWith: MARK } } });
const pendingRequests = (actionKey: string) => prisma.changeRequest.count({ where: { requestedBy: ACTOR, actionKey, status: "pending" } });
const newLeave = (employeeId: string, type: "annual" | "excused_absence" = "excused_absence") =>
  prisma.leave.create({ data: { employeeId, type, from: new Date("2030-01-15"), to: new Date("2030-01-15"), reason: `${MARK} ${type}` } });

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("deductions, penalties and advances wait for the admin or HR", () => {
  beforeEach(cleanUp);

  it("an account without the deductions permission can't even ask", async () => {
    session = user({ id: "U-1", name: ACTOR, role: "staff", permissions: ["employees"] });
    expect(await createDeduction({}, deductionForm(empA.id))).toHaveProperty("error");
    expect(await pendingRequests("deductions.create")).toBe(0);
    expect(await deductionsOf(empA.id)).toBe(0);
  });

  it("a supervisor with deductions — even with direct edit — only files a request; nothing is posted", async () => {
    await prisma.user.create({ data: { id: DIRECT_USER, name: ACTOR, email: "hr-approvals-direct@x.test", passwordHash: "-", role: "supervisor", permissions: ["deductions"], directEdit: true } });
    session = user({ id: DIRECT_USER, name: ACTOR, role: "supervisor", permissions: ["deductions"] });
    for (const type of ["penalty", "advance", "other"]) expect(await createDeduction({}, deductionForm(empA.id, type))).toMatchObject({ success: true });
    expect(await pendingRequests("deductions.create")).toBe(3);
    expect(await deductionsOf(empA.id)).toBe(0);
  });

  it("HR approves it from /change-requests and it is posted; HR can't approve other kinds of requests", async () => {
    session = user({ id: "U-2", name: ACTOR, role: "supervisor", permissions: ["deductions"] });
    await createDeduction({}, deductionForm(empA.id));
    const request = await prisma.changeRequest.findFirstOrThrow({ where: { requestedBy: ACTOR, actionKey: "deductions.create", status: "pending" } });

    session = user({ id: "U-hr", name: "approver-hr-test", role: "hr", permissions: ["deductions"] });
    expect(await approveChangeRequest(request.id)).toMatchObject({ success: true });
    expect(await deductionsOf(empA.id)).toBe(1);

    const other = await prisma.changeRequest.create({ data: { requestedById: "U-2", requestedBy: ACTOR, module: "x", actionLabel: "x", actionKey: "employees.update", summary: "x", payload: { id: empA.id } } });
    expect(await approveChangeRequest(other.id)).toHaveProperty("error");
    expect(await rejectChangeRequest(other.id)).toHaveProperty("error");
  });

  it("HR limited to a department can't approve one for an employee outside it", async () => {
    session = user({ id: "U-2", name: ACTOR, role: "supervisor", permissions: ["deductions"] });
    await createDeduction({}, deductionForm(empB.id));
    const request = await prisma.changeRequest.findFirstOrThrow({ where: { requestedBy: ACTOR, actionKey: "deductions.create", status: "pending" } });
    session = user({ id: "U-hr", name: "approver-hr-test", role: "hr", permissions: ["deductions"], departmentIds: [empA.departmentId] });
    expect(await approveChangeRequest(request.id)).toHaveProperty("error");
    expect(await deductionsOf(empB.id)).toBe(0);
  });

  it("the admin's or HR's own deduction is posted at once", async () => {
    session = user({ id: "U-hr", name: ACTOR, role: "hr", permissions: ["deductions"] });
    expect(await createDeduction({}, deductionForm(empA.id))).toMatchObject({ success: true });
    session = user({ id: "U-admin", name: ACTOR, role: "admin" });
    expect(await createDeduction({}, deductionForm(empA.id, "advance"))).toMatchObject({ success: true });
    expect(await deductionsOf(empA.id)).toBe(2);
    expect(await pendingRequests("deductions.create")).toBe(0);
  });
});

describe.skipIf(!sampleDb)("leaves and excuses are decided by the admin or HR only", () => {
  beforeEach(cleanUp);

  it("a supervisor with the leaves permission can't decide one — not even as a request", async () => {
    const leave = await newLeave(empA.id);
    session = user({ id: "U-3", name: ACTOR, role: "supervisor", permissions: ["leaves"] });
    expect(await decideLeave(leave.id, "approved")).toHaveProperty("error");
    expect(await pendingRequests("leaves.decide")).toBe(0);
    expect((await prisma.leave.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe("pending");
  });

  it("HR with leaves decides it, and the decision stands at once", async () => {
    const excuse = await newLeave(empA.id, "excused_absence");
    const annual = await newLeave(empA.id, "annual");
    session = user({ id: "U-hr", name: ACTOR, role: "hr", permissions: ["leaves"] });
    expect(await decideLeave(excuse.id, "approved")).toMatchObject({ success: true });
    expect(await decideLeave(annual.id, "rejected")).toMatchObject({ success: true });
    expect((await prisma.leave.findUniqueOrThrow({ where: { id: excuse.id } })).status).toBe("approved");
    expect((await prisma.leave.findUniqueOrThrow({ where: { id: annual.id } })).status).toBe("rejected");
  });

  it("HR without the leaves permission, or outside its department, can't", async () => {
    const leave = await newLeave(empB.id);
    session = user({ id: "U-hr", name: ACTOR, role: "hr", permissions: ["employees"] });
    expect(await decideLeave(leave.id, "approved")).toHaveProperty("error");
    session = user({ id: "U-hr", name: ACTOR, role: "hr", permissions: ["leaves"], departmentIds: [empA.departmentId] });
    expect(await decideLeave(leave.id, "approved")).toHaveProperty("error");
    expect((await prisma.leave.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe("pending");
  });
});
