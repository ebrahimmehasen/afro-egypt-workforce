import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";

/**
 * Case proof on real rows of the disposable TEST database (skipped anywhere else, see tests/setup/db-guard.ts): who may
 * create, see, edit and discard, the photo route, the upload checks, the AI fallback (the AI call is mocked), the audit
 * entries with the old and new text, and that none of it touches a punch, a day, payroll or any pay table.
 */
let session: User | null = null;
// route.ts and the photo actions always ask for the combined SET draft (even a single-photo upload is a set of one).
type Ai = typeof import("@/lib/case-proof/ai-draft").requestCaseSetDraft;
let aiImpl: Ai = async () => ({ ok: false, reason: "not_configured" });
const aiCalls: Parameters<Ai>[0][] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/case-proof/ai-draft", () => ({
  requestCaseSetDraft: async (opts: Parameters<Ai>[0]) => {
    aiCalls.push(opts);
    return aiImpl(opts);
  },
}));

const { POST: upload } = await import("@/app/api/case-proof/route");
const { GET: photo } = await import("@/app/api/case-proof/[id]/photo/route");
const { saveCaseProof, discardCaseProof } = await import("@/lib/actions/case-proof");
const { loadCaseProofs, loadCaseProof, loadEmployeeCaseProofTab } = await import("@/lib/case-proof/data");
const { CASE_PROOF_STORAGE_ROOT } = await import("@/lib/case-proof/files");
const { CASE_PROOF_LIMITS: L } = await import("@/lib/case-proof/config");

const prisma = new PrismaClient();
let hasDb = false;
try {
  hasDb = (await prisma.caseProof.count()) >= 0;
} catch {
  hasDb = false;
}

const TAG = "ZZ-CP";
const ACTOR = `${TAG} actor`;
let deptA = "";
let deptB = "";
let empA = "";
let empB = "";
let empA2 = "";
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let uid = 0;
const mk = (over: Partial<User>): User => ({ id: `${TAG}-u${++uid}`, name: ACTOR, email: `${TAG}${uid}@x`, role: "admin", permissions: [], ...over });
const admin = () => mk({ role: "admin" });
const supA = () => mk({ role: "supervisor", departmentIds: [deptA], permissions: ["attendance"] });
const supB = () => mk({ role: "supervisor", departmentIds: [deptB] });
const hr = () => mk({ role: "hr", departmentIds: [deptA], permissions: ["employees", "attendance", "leaves"] });

const request = (fields: Record<string, string | string[]>, file?: { bytes: Uint8Array; type: string; name?: string }, headers: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) form.append(k, one);
  if (file) form.set("photo", new File([file.bytes as BlobPart], file.name ?? "problem.png", { type: file.type }));
  return new Request("http://localhost/api/case-proof", { method: "POST", body: form, headers }) as never;
};
const post = (who: User | null, employeeId: string | string[], file: { bytes: Uint8Array; type: string } | null = { bytes: png(), type: "image/png" }) => {
  session = who;
  return upload(request({ employeeId }, file ?? undefined));
};
const getPhoto = (who: User | null, id: string) => {
  session = who;
  return photo(new Request("http://localhost/x") as never, { params: Promise.resolve({ id }) });
};
const files = () => (existsSync(CASE_PROOF_STORAGE_ROOT) ? readdirSync(CASE_PROOF_STORAGE_ROOT) : []);
const cases = (employeeId: string) => prisma.caseProof.findMany({ where: { employeeId } });
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function cleanup() {
  const rows = await prisma.caseProof.findMany({ where: { createdByName: ACTOR } });
  for (const r of rows) await import("node:fs/promises").then((fs) => fs.unlink(path.join(CASE_PROOF_STORAGE_ROOT, r.photoKey)).catch(() => undefined));
  await prisma.caseProof.deleteMany({ where: { createdByName: ACTOR } });
  await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  await prisma.employee.deleteMany({ where: { employeeNumber: { startsWith: TAG } } });
  await prisma.department.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  if (!hasDb) return;
  await cleanup();
  const shift = await prisma.shift.findFirstOrThrow();
  deptA = (await prisma.department.create({ data: { name: `${TAG} A` } })).id;
  deptB = (await prisma.department.create({ data: { name: `${TAG} B` } })).id;
  const employee = (n: string, departmentId: string) =>
    prisma.employee.create({ data: { employeeNumber: `${TAG}-${n}`, name: `${TAG} Employee ${n}`, departmentId, jobTitle: "x", hireDate: new Date("2018-01-01"), shiftId: shift.id, basicSalary: 6000 } }).then((e) => e.id);
  empA = await employee("A", deptA);
  empB = await employee("B", deptB);
  empA2 = await employee("A2", deptA);
});

afterAll(async () => {
  if (hasDb) await cleanup();
  await prisma.$disconnect();
});

beforeEach(() => {
  session = null;
  aiCalls.length = 0;
  aiImpl = async () => ({ ok: false, reason: "not_configured" });
});

describe.skipIf(!hasDb)("who may create a case", () => {
  it("the admin may, for anyone; the case records the employee's department and who made it", async () => {
    const who = admin();
    const res = await post(who, empB);
    expect(res.status).toBe(200);
    const [row] = await cases(empB);
    expect(row).toMatchObject({ departmentId: deptB, createdById: who.id, createdByName: ACTOR, status: "draft", photoMime: "image/png" });
  });

  it("a supervisor may for an employee in a department on his account, and refused for another department's employee", async () => {
    expect((await post(supA(), empA)).status).toBe(200);
    const before = files().length;
    const refused = await post(supA(), empB);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "noEmployee" });
    expect(await prisma.caseProof.count({ where: { employeeId: empB, createdByName: ACTOR, createdById: { startsWith: `${TAG}-u` }, departmentId: deptB } })).toBe(1); // only the admin's, from the first test
    expect(files().length).toBe(before);
  });

  it("refused, with nothing stored and no file written: HR (even with departments and grants), a staff account, an employee, a supervisor with no departments, and anonymous", async () => {
    const before = { rows: await prisma.caseProof.count(), files: files().length };
    for (const [name, who, status] of [
      ["hr", hr(), 403],
      ["staff", mk({ role: "staff", departmentIds: [deptA], permissions: ["employees"] }), 403],
      ["employee", mk({ role: "employee", departmentIds: [deptA] }), 403],
      ["supervisor with no departments", mk({ role: "supervisor", departmentIds: [], permissions: ["attendance"] }), 403],
      ["anonymous", null, 401],
    ] as const) {
      expect((await post(who, empA)).status, name).toBe(status);
    }
    expect({ rows: await prisma.caseProof.count(), files: files().length }).toEqual(before);
    expect(aiCalls).toEqual([]); // no photo was sent to the AI for a refused request
  });

  it("an unknown employee, none given, or no photo, is refused", async () => {
    expect((await post(admin(), "no-such-employee")).status).toBe(403);
    expect((await post(admin(), "")).status).toBe(403);
    expect((await post(admin(), empA, null)).status).toBe(400);
  });
});

describe.skipIf(!hasDb)("the photo checks on upload", () => {
  it("refuses a pdf, an executable posing as an image, an empty file and an oversize one: nothing stored", async () => {
    const before = { rows: await prisma.caseProof.count(), files: files().length };
    const who = admin();
    expect((await post(who, empA, { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]), type: "application/pdf" })).status).toBe(415);
    expect((await post(who, empA, { bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 3]), type: "image/png" })).status).toBe(415);
    expect((await post(who, empA, { bytes: new Uint8Array(), type: "image/png" })).status).toBe(400);
    const big = new Uint8Array(L.maxPhotoBytes + 1);
    big.set(png());
    expect((await post(who, empA, { bytes: big, type: "image/png" })).status).toBe(413);
    expect({ rows: await prisma.caseProof.count(), files: files().length }).toEqual(before);
  });

  it("refuses a request that says it is too large before reading it", async () => {
    session = admin();
    const res = await upload(request({ employeeId: empA }, { bytes: png(), type: "image/png" }, { "content-length": String(L.maxRequestBytes + 1) }));
    expect(res.status).toBe(413);
  });

  it("stores the photo under a random key in the private folder, never under its own name", async () => {
    const res = await post(admin(), empA, { bytes: png(), type: "image/png" });
    const { id } = (await res.json()) as { id: string };
    const row = (await prisma.caseProof.findUnique({ where: { id } }))!;
    expect(row.photoKey).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(existsSync(path.join(CASE_PROOF_STORAGE_ROOT, row.photoKey))).toBe(true);
    expect(CASE_PROOF_STORAGE_ROOT.split(path.sep)).not.toContain("public");
  });
});

describe.skipIf(!hasDb)("the AI draft and its fallback", () => {
  it("a working AI gives a draft that is stored as the AI's, with the department, uploader and employee as context", async () => {
    aiImpl = async () => ({ ok: true, text: "A cracked carton on the packing line." });
    const who = supA();
    const body = (await (await post(who, empA)).json()) as { id: string; draft: string | null; aiAvailable: boolean };
    expect(body).toMatchObject({ draft: "A cracked carton on the packing line.", aiAvailable: true });
    expect(await prisma.caseProof.findUnique({ where: { id: body.id } })).toMatchObject({ aiDraft: "A cracked carton on the packing line.", aiGenerated: true, finalText: null, status: "draft" });
    expect(aiCalls).toHaveLength(1);
    // the department and the uploader only: the employee name is never handed to the AI
    expect(aiCalls[0].context).toEqual({ department: `${TAG} A`, uploader: ACTOR, locale: "ar" });
    expect(JSON.stringify(aiCalls[0].context)).not.toContain("Employee");
    expect(aiCalls[0].images).toHaveLength(1);
    expect(aiCalls[0].images[0].mime).toBe("image/png");
  });

  it("when the AI call fails, the draft is empty (never a made-up one), the reason is given, and the whole flow still works", async () => {
    aiImpl = async () => ({ ok: false, reason: "unavailable" });
    const who = supA();
    const res = await post(who, empA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; draft: string | null; aiAvailable: boolean; reason?: string };
    expect(body).toMatchObject({ draft: null, aiAvailable: false, reason: "unavailable" });
    expect(await prisma.caseProof.findUnique({ where: { id: body.id } })).toMatchObject({ aiDraft: null, aiGenerated: false });

    session = who;
    expect(await saveCaseProof({}, form({ id: body.id, text: "Wrote it myself: the label was upside down." }))).toMatchObject({ success: true });
    expect(await prisma.caseProof.findUnique({ where: { id: body.id } })).toMatchObject({ status: "saved", finalText: "Wrote it myself: the label was upside down.", aiGenerated: false });
  });

  it("when the AI call throws, it is the same: an empty field and a case that exists", async () => {
    aiImpl = async () => {
      throw new Error("boom");
    };
    const res = await post(supA(), empA);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ draft: null, aiAvailable: false });
  });

  it("is not asked about a refused photo", async () => {
    aiImpl = async () => ({ ok: true, text: "should not be used" });
    await post(admin(), empA, { bytes: new Uint8Array([0x4d, 0x5a]), type: "image/png" });
    expect(aiCalls).toEqual([]);
  });
});

describe.skipIf(!hasDb)("saving, editing and the audit trail", () => {
  it("the first save records the AI draft as the old text and the edited text as the new; an edit records the previous text", async () => {
    aiImpl = async () => ({ ok: true, text: "AI: a broken pallet." });
    const who = supA();
    const { id } = (await (await post(who, empA)).json()) as { id: string };
    session = who;
    expect(await saveCaseProof({}, form({ id, text: "A broken pallet, found at 10:00 in the loading bay." }))).toMatchObject({ success: true });
    expect(await saveCaseProof({}, form({ id, text: "A broken pallet, found at 10:05 in the loading bay." }))).toMatchObject({ success: true });

    const row = (await prisma.caseProof.findUnique({ where: { id } }))!;
    expect(row).toMatchObject({ status: "saved", finalText: "A broken pallet, found at 10:05 in the loading bay.", aiDraft: "AI: a broken pallet.", aiGenerated: true });
    expect(row.savedAt).not.toBeNull();

    const saves = await prisma.auditLogEntry.findMany({ where: { userName: ACTOR, action: ar.auditActions.saveCaseProof, newValue: { contains: "10:00" } } });
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ oldValue: "AI: a broken pallet.", module: ar.caseProof.title });
    expect(saves[0].reason).toContain(`${TAG}-A`);
    const edits = await prisma.auditLogEntry.findMany({ where: { userName: ACTOR, action: ar.auditActions.editCaseProof, newValue: { contains: "10:05" } } });
    expect(edits).toHaveLength(1);
    expect(edits[0].oldValue).toBe("A broken pallet, found at 10:00 in the loading bay.");
  });

  it("refuses an empty or too-short text, and one that is too long", async () => {
    const who = supA();
    const { id } = (await (await post(who, empA)).json()) as { id: string };
    session = who;
    expect(await saveCaseProof({}, form({ id, text: "  " }))).toMatchObject({ error: ar.caseProof.errors.textRequired });
    expect(await saveCaseProof({}, form({ id, text: "x".repeat(L.maxTextLength + 1) }))).toMatchObject({ error: ar.caseProof.errors.textRequired });
    expect((await prisma.caseProof.findUnique({ where: { id } }))!.status).toBe("draft");
  });

  it("another department's supervisor, HR, an employee and anonymous cannot save or discard it: it is 'not found' or refused", async () => {
    const owner = supA();
    const { id } = (await (await post(owner, empA)).json()) as { id: string };
    for (const [name, who, expected] of [
      ["other department", supB(), ar.caseProof.errors.notFound],
      ["hr", hr(), ar.validation.notAllowed],
      ["employee", mk({ role: "employee" }), ar.validation.notAllowed],
      ["anonymous", null, ar.validation.notAllowed],
    ] as const) {
      session = who;
      expect(await saveCaseProof({}, form({ id, text: "Changed by someone else" })), name).toMatchObject({ error: expected });
      expect(await discardCaseProof(id), name).toMatchObject({ error: expected });
    }
    expect(await prisma.caseProof.findUnique({ where: { id } })).toMatchObject({ status: "draft", finalText: null });
  });

  it("a co-supervisor of the same department can read a case but not change it; the admin can change any", async () => {
    const owner = supA();
    const { id } = (await (await post(owner, empA)).json()) as { id: string };
    session = owner;
    await saveCaseProof({}, form({ id, text: "Original text by the owner" }));
    const coSupervisor = supA();
    expect((await getPhoto(coSupervisor, id)).status).toBe(200);
    session = coSupervisor;
    expect(await saveCaseProof({}, form({ id, text: "Rewritten by a colleague" }))).toMatchObject({ error: ar.validation.notAllowed });
    session = admin();
    expect(await saveCaseProof({}, form({ id, text: "Edited by the manager" }))).toMatchObject({ success: true });
    expect((await prisma.caseProof.findUnique({ where: { id } }))!.finalText).toBe("Edited by the manager");
  });

  it("discarding an unsaved case removes the row and the photo; a saved case cannot be discarded", async () => {
    const who = supA();
    const draft = (await (await post(who, empA)).json()) as { id: string };
    const key = (await prisma.caseProof.findUnique({ where: { id: draft.id } }))!.photoKey;
    session = who;
    expect(await discardCaseProof(draft.id)).toMatchObject({ success: true });
    expect(await prisma.caseProof.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(existsSync(path.join(CASE_PROOF_STORAGE_ROOT, key))).toBe(false);
    expect(await prisma.auditLogEntry.count({ where: { userName: ACTOR, action: ar.auditActions.discardCaseProof } })).toBeGreaterThan(0);

    const kept = (await (await post(who, empA)).json()) as { id: string };
    session = who;
    await saveCaseProof({}, form({ id: kept.id, text: "A saved record" }));
    expect(await discardCaseProof(kept.id)).toEqual({ error: ar.caseProof.errors.locked });
    expect(await prisma.caseProof.findUnique({ where: { id: kept.id } })).not.toBeNull();
  });
});

describe.skipIf(!hasDb)("seeing cases and photos", () => {
  let idA = "";
  let idB = "";
  beforeAll(async () => {
    idA = (await (await post(admin(), empA)).json().then((b) => b as { id: string })).id;
    idB = (await (await post(admin(), empB)).json().then((b) => b as { id: string })).id;
  });

  it("the admin sees every department's cases; a supervisor only his departments'; HR, an employee and anonymous none", async () => {
    const ids = async (who: User | null) => (who ? (await loadCaseProofs(who)).map((c) => c.id) : []);
    const adminIds = await ids(admin());
    expect(adminIds).toEqual(expect.arrayContaining([idA, idB]));
    const a = await ids(supA());
    expect(a).toContain(idA);
    expect(a).not.toContain(idB);
    expect(await ids(supB())).not.toContain(idA);
    expect(await ids(hr())).toEqual([]);
    expect(await ids(mk({ role: "employee" }))).toEqual([]);
    expect(await ids(mk({ role: "supervisor", departmentIds: [] }))).toEqual([]);
    expect((await loadCaseProofs(supA(), { employeeId: empB })).length).toBe(0);
  });

  it("the photo: the admin and the department's supervisor get it (inline, fixed type, no sniffing); another department 404; HR and an employee 403; anonymous 401", async () => {
    for (const who of [admin(), supA()]) {
      const res = await getPhoto(who, idA);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("sandbox");
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(png()));
    }
    expect((await getPhoto(supA(), idB)).status).toBe(404);
    expect((await getPhoto(supB(), idA)).status).toBe(404);
    expect((await getPhoto(hr(), idA)).status).toBe(403);
    expect((await getPhoto(mk({ role: "employee" }), idA)).status).toBe(403);
    expect((await getPhoto(mk({ role: "supervisor", departmentIds: [] }), idA)).status).toBe(403);
    expect((await getPhoto(null, idA)).status).toBe(401);
    expect((await getPhoto(admin(), "no-such-case")).status).toBe(404);
  });
});

describe.skipIf(!hasDb)("it has no effect on punches, attendance, payroll or any pay table", () => {
  it("a whole flow (upload, AI draft, save, edit, discard) leaves every employee-keyed pay and attendance row of these employees untouched", async () => {
    const tables = async () => {
      const where = { employeeId: { in: [empA, empB] } };
      return Promise.all([
        prisma.attendanceLog.count({ where }),
        prisma.dailyAttendance.count({ where }),
        prisma.payrollRecord.count({ where }),
        prisma.deduction.count({ where }),
        prisma.overtime.count({ where }),
        prisma.leave.count({ where }),
        prisma.allowance.count({ where }),
      ]);
    };
    const employeeBefore = await prisma.employee.findUnique({ where: { id: empA } });
    const before = await tables();
    expect(before).toEqual([0, 0, 0, 0, 0, 0, 0]);

    aiImpl = async () => ({ ok: true, text: "AI: a stained uniform." });
    const who = supA();
    const { id } = (await (await post(who, empA)).json()) as { id: string };
    session = who;
    await saveCaseProof({}, form({ id, text: "A stained uniform" }));
    await saveCaseProof({}, form({ id, text: "A stained uniform, reported twice" }));
    const other = (await (await post(who, empA)).json()) as { id: string };
    await discardCaseProof(other.id);

    expect(await tables()).toEqual(before);
    expect(await prisma.employee.findUnique({ where: { id: empA } })).toEqual(employeeBefore);
  });
});

describe.skipIf(!hasDb)("a case about a group of employees", () => {
  const rowCount = () => prisma.caseProof.count();
  const linkCount = () => prisma.caseProofEmployee.count();

  it("the admin may pick employees of several departments: one case, one link per employee, the first is the primary", async () => {
    aiImpl = async () => ({ ok: true, text: "AI: a spilled pallet of cartons." });
    const res = await post(admin(), [empA, empB, empA2]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; employees: number };
    expect(body.employees).toBe(3);
    const row = (await prisma.caseProof.findUnique({ where: { id: body.id }, include: { links: true } }))!;
    expect(row).toMatchObject({ employeeId: empA, departmentId: deptA });
    expect(row.links.map((l) => [l.employeeId, l.departmentId]).sort()).toEqual([[empA, deptA], [empA2, deptA], [empB, deptB]].sort());
    // the draft was asked for once, with the departments and the uploader only
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0].context).toEqual({ department: `${TAG} A, ${TAG} B`, uploader: ACTOR, locale: "ar" });
    expect(JSON.stringify(aiCalls[0].context)).not.toContain("Employee");
  });

  it("a supervisor may pick several employees, all inside his own departments", async () => {
    const res = await post(supA(), [empA, empA2]);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(await prisma.caseProofEmployee.count({ where: { caseProofId: id } })).toBe(2);
  });

  it("ONE employee outside his departments refuses the whole request: nothing is created for the others, no file, no AI call", async () => {
    const before = { rows: await rowCount(), links: await linkCount(), files: files().length };
    aiImpl = async () => ({ ok: true, text: "must not be asked" });
    for (const picked of [[empA, empB], [empB, empA], [empA, empA2, empB], [empA, "no-such-employee"], [empB]]) {
      const res = await post(supA(), picked);
      expect(res.status, picked.join()).toBe(403);
      expect(await res.json()).toMatchObject({ error: "noEmployee" });
    }
    expect({ rows: await rowCount(), links: await linkCount(), files: files().length }).toEqual(before);
    expect(aiCalls).toEqual([]);
  });

  it("HR is refused for a group too, even holding every grant and the same department; so are an employee, a staff account and anonymous", async () => {
    const before = { rows: await rowCount(), links: await linkCount(), files: files().length };
    for (const [who, status] of [[hr(), 403], [mk({ role: "employee" }), 403], [mk({ role: "staff", departmentIds: [deptA] }), 403], [null, 401]] as const) {
      expect((await post(who, [empA, empA2])).status).toBe(status);
    }
    expect({ rows: await rowCount(), links: await linkCount(), files: files().length }).toEqual(before);
  });

  it("the same employee twice counts once; more than the limit is refused", async () => {
    const res = await post(admin(), [empA, empA, empA]);
    const { id } = (await res.json()) as { id: string };
    expect(await prisma.caseProofEmployee.count({ where: { caseProofId: id } })).toBe(1);
    const many = Array.from({ length: L.maxEmployeesPerCase + 1 }, (_, i) => `e${i}`);
    expect((await post(admin(), many)).status).toBe(400);
  });

  describe("and where it shows", () => {
    let groupId = "";
    let crossId = "";
    const text = `${TAG} group text: the pallet was left in the aisle`;
    const crossText = `${TAG} cross-department text: the machine was left running`;
    beforeAll(async () => {
      const supervisor = supA();
      groupId = ((await (await post(supervisor, [empA, empA2])).json()) as { id: string }).id;
      session = supervisor;
      await saveCaseProof({}, form({ id: groupId, text }));
      const manager = admin();
      crossId = ((await (await post(manager, [empA, empB])).json()) as { id: string }).id;
      session = manager;
      await saveCaseProof({}, form({ id: crossId, text: crossText }));
    });

    it("a saved group case appears under EACH linked employee profile tab, for the admin and for the department supervisor", async () => {
      for (const [who, name] of [[admin(), "admin"], [supA(), "supervisor"]] as const) {
        for (const emp of [{ id: empA, departmentId: deptA }, { id: empA2, departmentId: deptA }]) {
          const tab = await loadEmployeeCaseProofTab(who, emp);
          expect(tab.show, `${name} ${emp.id}`).toBe(true);
          const found = tab.cases.find((c) => c.id === groupId)!;
          expect(found, `${name} ${emp.id}`).toBeTruthy();
          expect(found.finalText).toBe(text);
          expect(found.employees.map((e) => e.id).sort()).toEqual([empA, empA2].sort());
        }
      }
    });

    it("only saved cases are on the tab (a draft is not)", async () => {
      const draftId = ((await (await post(supA(), [empA, empA2])).json()) as { id: string }).id;
      const tab = await loadEmployeeCaseProofTab(admin(), { id: empA2, departmentId: deptA });
      expect(tab.cases.some((c) => c.id === draftId)).toBe(false);
    });

    it("a case across two departments: each department supervisor sees it under his own employee and is shown only his own employees", async () => {
      const a = await loadEmployeeCaseProofTab(supA(), { id: empA, departmentId: deptA });
      const caseA = a.cases.find((c) => c.id === crossId)!;
      expect(caseA.employees.map((e) => e.id)).toEqual([empA]);
      expect(JSON.stringify(caseA)).not.toContain(`${TAG} Employee B`);

      const b = await loadEmployeeCaseProofTab(supB(), { id: empB, departmentId: deptB });
      const caseB = b.cases.find((c) => c.id === crossId)!;
      expect(caseB.employees.map((e) => e.id)).toEqual([empB]);
      expect(JSON.stringify(caseB)).not.toContain(`${TAG} Employee A`);

      // the admin sees everyone it is attached to
      const all = await loadEmployeeCaseProofTab(admin(), { id: empB, departmentId: deptB });
      expect(all.cases.find((c) => c.id === crossId)!.employees.map((e) => e.id).sort()).toEqual([empA, empB].sort());
    });

    it("a supervisor sees nothing under an employee of a department that is not his, nor a group case with none of his people", async () => {
      expect(await loadEmployeeCaseProofTab(supB(), { id: empA, departmentId: deptA })).toEqual({ show: false, cases: [] });
      expect(await loadCaseProof(supB(), groupId)).toBeNull();
      expect((await getPhoto(supB(), groupId)).status).toBe(404);
      expect((await loadCaseProofs(supB())).some((c) => c.id === groupId)).toBe(false);
    });

    it("HR, an employee, a staff account and a supervisor with no departments: no tab and no data, and no list, detail or photo", async () => {
      for (const [name, who] of [
        ["hr", hr()],
        ["employee", mk({ role: "employee", departmentIds: [deptA] })],
        ["staff", mk({ role: "staff", departmentIds: [deptA], permissions: ["employees"] })],
        ["supervisor with no departments", mk({ role: "supervisor", departmentIds: [] })],
      ] as const) {
        expect(await loadEmployeeCaseProofTab(who, { id: empA, departmentId: deptA }), name).toEqual({ show: false, cases: [] });
        expect(await loadCaseProofs(who), name).toEqual([]);
        expect(await loadCaseProof(who, groupId), name).toBeNull();
        expect((await getPhoto(who, groupId)).status, name).toBe(403);
      }
      expect((await getPhoto(null, groupId)).status).toBe(401);
    });

    it("editing the text of a group case changes it under every employee, and the audit entry names them all", async () => {
      session = admin();
      await saveCaseProof({}, form({ id: groupId, text: `${text} (edited)` }));
      for (const emp of [empA, empA2]) {
        const tab = await loadEmployeeCaseProofTab(admin(), { id: emp, departmentId: deptA });
        expect(tab.cases.find((c) => c.id === groupId)!.finalText).toBe(`${text} (edited)`);
      }
      const entry = await prisma.auditLogEntry.findFirst({ where: { userName: ACTOR, action: ar.auditActions.editCaseProof, newValue: { contains: "(edited)" } } });
      expect(entry!.reason).toContain(`${TAG}-A`);
      expect(entry!.reason).toContain(`${TAG}-A2`);
    });

    it("discarding an unsaved group case removes every link with it", async () => {
      const supervisor = supA();
      const { id } = (await (await post(supervisor, [empA, empA2])).json()) as { id: string };
      expect(await prisma.caseProofEmployee.count({ where: { caseProofId: id } })).toBe(2);
      session = supervisor;
      expect(await discardCaseProof(id)).toMatchObject({ success: true });
      expect(await prisma.caseProofEmployee.count({ where: { caseProofId: id } })).toBe(0);
    });
  });
});

describe.skipIf(!hasDb)("the migration keeps an existing single-employee case valid", () => {
  it("copies a case that has no link into the join table, and is safe to run twice", async () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261127120000_case_proof_employees", "migration.sql"), "utf8");
    const backfill = sql.slice(sql.indexOf("INSERT IGNORE")).trim().replace(/;\s*$/, "");
    const legacy = await prisma.caseProof.create({
      data: { employeeId: empA, departmentId: deptA, createdById: `${TAG}-legacy`, createdByName: ACTOR, photoKey: `${TAG}-legacy.png`, photoMime: "image/png", photoSize: 1, status: "saved", finalText: "Saved before group cases existed" },
    });
    expect(await prisma.caseProofEmployee.count({ where: { caseProofId: legacy.id } })).toBe(0);
    await prisma.$executeRawUnsafe(backfill);
    await prisma.$executeRawUnsafe(backfill);
    const links = await prisma.caseProofEmployee.findMany({ where: { caseProofId: legacy.id } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ employeeId: empA, departmentId: deptA });
    // and it now shows under that employee like any other case
    const tab = await loadEmployeeCaseProofTab(admin(), { id: empA, departmentId: deptA });
    expect(tab.cases.some((c) => c.id === legacy.id && c.finalText === "Saved before group cases existed")).toBe(true);
  });
});
