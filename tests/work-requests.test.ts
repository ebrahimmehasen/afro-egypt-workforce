import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { canAccess, canApprove } from "@/lib/permissions";
import { visibleWorkRequests, type WorkRequestRow } from "@/lib/work-requests";
import type { User } from "@/lib/types";

/**
 * Work requests ("الطلبات"): an account granted "requests" (a supervisor, HR…) files a request — "سهر" or
 * anything else — for workers of its department; the system admin or HR holding "requests" approves or rejects
 * it. A record only: it changes no attendance, overtime, deductions or pay.
 */
const user = (over: Partial<User>): User => ({ id: "U", name: "U", email: "u@x", role: "supervisor", permissions: [], ...over });
const row = (over: Partial<WorkRequestRow>): WorkRequestRow => ({
  id: "R", type: "late_work", date: "2030-01-15", fromTime: "18:00", toTime: "22:00", details: "x", employeeIds: [], status: "pending",
  requestedById: "someone", requestedBy: "x", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "", ...over,
});

describe("who sees and decides requests", () => {
  it("the page opens with the requests permission only", () => {
    expect(canAccess(user({ permissions: ["requests"] }), "/requests")).toBe(true);
    expect(canAccess(user({ permissions: ["overtime"] }), "/requests")).toBe(false);
    expect(canAccess(user({ role: "admin" }), "/requests")).toBe(true);
  });

  it("decided by the admin, or HR holding requests — not a supervisor", () => {
    expect(canApprove(user({ role: "admin" }), "requests")).toBe(true);
    expect(canApprove(user({ role: "hr", permissions: ["requests"] }), "requests")).toBe(true);
    expect(canApprove(user({ role: "supervisor", permissions: ["requests"] }), "requests")).toBe(false);
  });

  it("within a department: the ones you filed, and any naming one of your workers", () => {
    const rows = [row({ id: "mine", requestedById: "me", employeeIds: ["other"] }), row({ id: "ours", employeeIds: ["w1", "x"] }), row({ id: "theirs", employeeIds: ["x"] })];
    const scope = { all: false as const, ids: new Set(["w1"]) };
    expect(visibleWorkRequests(rows, { id: "me" }, scope).map((r) => r.id)).toEqual(["mine", "ours"]);
    expect(visibleWorkRequests(rows, { id: "me" }, { all: true })).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Through the real actions, on the sample-seeded dev database (skipped anywhere else, so never on real data).

let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { createWorkRequest, decideWorkRequest } = await import("@/lib/actions/work-requests");

const prisma = new PrismaClient();
let sampleDb = false;
let empA = { id: "", departmentId: "" };
let empB = { id: "", departmentId: "" };
try {
  sampleDb = Boolean(await prisma.user.findUnique({ where: { email: "hr@afroegypt.demo" } }));
  if (sampleDb) {
    const seeded = { deletedAt: null, id: { startsWith: "EMP-" } };
    empA = await prisma.employee.findFirstOrThrow({ where: seeded, orderBy: { id: "asc" }, select: { id: true, departmentId: true } });
    empB = await prisma.employee.findFirstOrThrow({ where: { ...seeded, departmentId: { not: empA.departmentId } }, orderBy: { id: "asc" }, select: { id: true, departmentId: true } });
  }
} catch {
  sampleDb = false;
}

const ACTOR = "work-requests-test";
const MARK = "اختبار طلبات";
const cleanUp = async () => {
  await prisma.workRequest.deleteMany({ where: { details: { startsWith: MARK } } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: { in: [ACTOR, "approver-test"] } } });
};
const form = (fields: Record<string, string>, employeeIds: string[]) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const id of employeeIds) f.append("employeeIds", id);
  return f;
};
const lateWork = (employeeIds: string[], over: Record<string, string> = {}) =>
  form({ type: "late_work", date: "2030-01-15", fromTime: "18:00", toTime: "22:00", details: `${MARK} سهر`, ...over }, employeeIds);
const supervisorA = () => user({ id: "U-sup", name: ACTOR, role: "supervisor", permissions: ["requests"], departmentIds: [empA.departmentId] });
const latest = () => prisma.workRequest.findFirstOrThrow({ where: { details: { startsWith: MARK } }, orderBy: { createdAt: "desc" } });

afterAll(async () => {
  if (sampleDb) await cleanUp();
  await prisma.$disconnect();
});

describe.skipIf(!sampleDb)("filing a request", () => {
  beforeEach(cleanUp);

  it("a supervisor files one for several of their workers; it waits as pending", async () => {
    const others = await prisma.employee.findMany({ where: { departmentId: empA.departmentId, deletedAt: null, id: { startsWith: "EMP-" } }, take: 3, select: { id: true } });
    session = supervisorA();
    expect(await createWorkRequest({}, lateWork(others.map((e) => e.id)))).toMatchObject({ success: true });
    const r = await latest();
    expect(r).toMatchObject({ status: "pending", type: "late_work", fromTime: "18:00", toTime: "22:00", requestedBy: ACTOR });
    expect(r.employeeIds).toEqual(others.map((e) => e.id));
  });

  it("an \"other\" request needs no hours", async () => {
    session = supervisorA();
    expect(await createWorkRequest({}, form({ type: "other", date: "2030-01-15", details: `${MARK} حاجة تانية` }, [empA.id]))).toMatchObject({ success: true });
  });

  it("refused: a worker outside the department, no workers, late work without hours, or no requests permission", async () => {
    session = supervisorA();
    expect(await createWorkRequest({}, lateWork([empA.id, empB.id]))).toHaveProperty("error");
    expect(await createWorkRequest({}, lateWork([]))).toHaveProperty("error");
    expect(await createWorkRequest({}, lateWork([empA.id], { fromTime: "", toTime: "" }))).toHaveProperty("error");
    session = user({ id: "U-x", name: ACTOR, role: "supervisor", permissions: ["overtime"] });
    expect(await createWorkRequest({}, lateWork([empA.id]))).toHaveProperty("error");
    expect(await prisma.workRequest.count({ where: { details: { startsWith: MARK } } })).toBe(0);
  });
});

describe.skipIf(!sampleDb)("deciding a request", () => {
  beforeEach(cleanUp);

  it("a supervisor can't decide; HR with requests approves; a second decision is refused", async () => {
    session = supervisorA();
    await createWorkRequest({}, lateWork([empA.id]));
    const r = await latest();
    expect(await decideWorkRequest(r.id, "approved")).toHaveProperty("error");

    session = user({ id: "U-hr", name: "approver-test", role: "hr", permissions: ["requests"] });
    expect(await decideWorkRequest(r.id, "approved")).toMatchObject({ success: true });
    expect(await prisma.workRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "approved", decidedBy: "approver-test" });
    expect(await decideWorkRequest(r.id, "rejected")).toHaveProperty("error");
  });

  it("the admin rejects with a reason; HR limited to another department can't decide it", async () => {
    session = supervisorA();
    await createWorkRequest({}, lateWork([empA.id]));
    const r = await latest();
    session = user({ id: "U-hr", name: "approver-test", role: "hr", permissions: ["requests"], departmentIds: [empB.departmentId] });
    expect(await decideWorkRequest(r.id, "approved")).toHaveProperty("error");
    session = user({ id: "U-admin", name: "approver-test", role: "admin" });
    expect(await decideWorkRequest(r.id, "rejected", "مش محتاجين")).toMatchObject({ success: true });
    expect(await prisma.workRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "rejected", decisionNote: "مش محتاجين" });
  });

  it("filing and approving posts no attendance, overtime or deduction (so nothing reaches pay)", async () => {
    // for that worker on that day (a date no other test file uses, since they run in parallel)
    const day = new Date("2030-01-16T00:00:00Z");
    const mine = { employeeId: empA.id, date: day };
    const counts = () =>
      Promise.all([prisma.overtime.count({ where: mine }), prisma.deduction.count({ where: mine }), prisma.dailyAttendance.count({ where: mine })]);
    const before = await counts();
    session = supervisorA();
    await createWorkRequest({}, lateWork([empA.id], { date: "2030-01-16" }));
    session = user({ id: "U-admin", name: "approver-test", role: "admin" });
    await decideWorkRequest((await latest()).id, "approved");
    expect(await counts()).toEqual(before);
  });
});
