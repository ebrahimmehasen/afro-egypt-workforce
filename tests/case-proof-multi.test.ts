import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";

/**
 * Multi-photo case proof on real rows of the disposable TEST database (skipped anywhere else, see tests/setup/db-guard.ts):
 * several photos in one upload, adding/removing a photo from an existing case, the combined-set AI draft being re-asked
 * with the FULL current set on every add/remove (never just the one that changed), the AI failure fallback, that a
 * refreshed draft never overwrites an already-saved finalText, a legacy single-photo case still displaying, and that
 * access control is unchanged. The AI call is mocked (see tests/case-proof-db.test.ts for the single-upload coverage).
 */
let session: User | null = null;
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
const { addCaseProofPhotos, removeCaseProofPhoto, saveCaseProof } = await import("@/lib/actions/case-proof");
const { loadCaseProof } = await import("@/lib/case-proof/data");
const { CASE_PROOF_STORAGE_ROOT } = await import("@/lib/case-proof/files");
const { CASE_PROOF_LIMITS: L } = await import("@/lib/case-proof/config");

const prisma = new PrismaClient();
let hasDb = false;
try {
  hasDb = (await prisma.caseProof.count()) >= 0;
} catch {
  hasDb = false;
}

const TAG = "ZZ-CPM";
const ACTOR = `${TAG} actor`;
let deptA = "";
let empA = "";

const png = (tag = 1) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag]);
let uid = 0;
const mk = (over: Partial<User>): User => ({ id: `${TAG}-u${++uid}`, name: ACTOR, email: `${TAG}${uid}@x`, role: "admin", permissions: [], ...over });
const admin = () => mk({ role: "admin" });
const supA = () => mk({ role: "supervisor", departmentIds: [deptA], permissions: ["attendance"] });
const hr = () => mk({ role: "hr", departmentIds: [deptA], permissions: ["employees", "attendance", "leaves"] });

function uploadRequest(employeeId: string, files: { bytes: Uint8Array; type: string }[]) {
  const form = new FormData();
  form.append("employeeId", employeeId);
  for (const f of files) form.append("photo", new File([f.bytes as BlobPart], "problem.png", { type: f.type }));
  return new Request("http://localhost/api/case-proof", { method: "POST", body: form }) as never;
}
const post = (who: User | null, employeeId: string, files: { bytes: Uint8Array; type: string }[] = [{ bytes: png(1), type: "image/png" }]) => {
  session = who;
  return upload(uploadRequest(employeeId, files));
};
const addForm = (files: { bytes: Uint8Array; type: string }[]) => {
  const form = new FormData();
  for (const f of files) form.append("photo", new File([f.bytes as BlobPart], "more.png", { type: f.type }));
  return form;
};
const files = () => (existsSync(CASE_PROOF_STORAGE_ROOT) ? readdirSync(CASE_PROOF_STORAGE_ROOT) : []);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function cleanup() {
  const rows = await prisma.caseProof.findMany({ where: { createdByName: ACTOR }, include: { photos: true } });
  const fs = await import("node:fs/promises");
  for (const r of rows) for (const p of r.photos) await fs.unlink(path.join(CASE_PROOF_STORAGE_ROOT, p.photoKey)).catch(() => undefined);
  for (const r of rows) await fs.unlink(path.join(CASE_PROOF_STORAGE_ROOT, r.photoKey)).catch(() => undefined);
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
  empA = (
    await prisma.employee.create({
      data: { employeeNumber: `${TAG}-A`, name: `${TAG} Employee A`, departmentId: deptA, jobTitle: "x", hireDate: new Date("2018-01-01"), shiftId: shift.id, basicSalary: 6000 },
    })
  ).id;
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

describe.skipIf(!hasDb)("uploading several photos at once", () => {
  it("creates one CaseProofPhoto row per photo, in the order picked, the first mirrored onto the legacy columns", async () => {
    const who = admin();
    const res = await post(who, empA, [{ bytes: png(1), type: "image/png" }, { bytes: png(2), type: "image/png" }, { bytes: png(3), type: "image/png" }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; photos: { id: string; position: number }[] };
    expect(body.photos).toHaveLength(3);
    expect(body.photos.map((p) => p.position)).toEqual([0, 1, 2]);

    const rows = await prisma.caseProofPhoto.findMany({ where: { caseProofId: body.id }, orderBy: { position: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((r) => r.photoKey)).size).toBe(3); // three distinct files, never the same key twice

    const row = (await prisma.caseProof.findUnique({ where: { id: body.id } }))!;
    expect(row.photoKey).toBe(rows[0].photoKey); // legacy single-photo columns mirror the first photo
  });

  it("refuses more photos than the per-case limit, an oversize or bad-type photo among them, and an empty upload — nothing partial is stored", async () => {
    const before = { rows: await prisma.caseProof.count(), photoRows: await prisma.caseProofPhoto.count(), files: files().length };
    const who = admin();

    const tooMany = Array.from({ length: L.maxPhotosPerCase + 1 }, (_, i) => ({ bytes: png(i), type: "image/png" }));
    expect((await post(who, empA, tooMany)).status).toBe(400);

    const big = new Uint8Array(L.maxPhotoBytes + 1);
    big.set(png(9));
    const mixedBadSize = [{ bytes: png(1), type: "image/png" }, { bytes: big, type: "image/png" }];
    expect((await post(who, empA, mixedBadSize)).status).toBe(413);

    const mixedBadType = [{ bytes: png(1), type: "image/png" }, { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), type: "application/pdf" }];
    expect((await post(who, empA, mixedBadType)).status).toBe(415);

    expect((await post(who, empA, [])).status).toBe(400);

    expect({ rows: await prisma.caseProof.count(), photoRows: await prisma.caseProofPhoto.count(), files: files().length }).toEqual(before);
    expect(aiCalls).toEqual([]);
  });
});

describe.skipIf(!hasDb)("adding and removing photos re-reads the FULL current set", () => {
  it("adding a photo asks the AI with every photo of the case, not just the new one", async () => {
    aiImpl = async () => ({ ok: true, text: "AI: two photos of a cracked carton." });
    const who = supA();
    const { id } = (await (await post(who, empA, [{ bytes: png(1), type: "image/png" }])).json()) as { id: string };
    aiCalls.length = 0;

    session = who;
    aiImpl = async () => ({ ok: true, text: "AI: now three photos, a cracked carton and a spill." });
    const result = await addCaseProofPhotos(id, addForm([{ bytes: png(2), type: "image/png" }, { bytes: png(3), type: "image/png" }]));
    expect(result.success).toBe(true);
    expect(result.photos).toHaveLength(3);
    expect(result.draft).toBe("AI: now three photos, a cracked carton and a spill.");
    expect(result.aiAvailable).toBe(true);

    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0].images).toHaveLength(3); // the full set, not just the two just added
    expect(await prisma.caseProof.findUnique({ where: { id } })).toMatchObject({ aiDraft: "AI: now three photos, a cracked carton and a spill.", aiGenerated: true });
  });

  it("removing a photo asks the AI with the remaining photos only, and refuses to remove the last one", async () => {
    aiImpl = async () => ({ ok: true, text: "AI: three photos of a spill." });
    const who = admin();
    const { id, photos } = (await (await post(who, empA, [{ bytes: png(1), type: "image/png" }, { bytes: png(2), type: "image/png" }, { bytes: png(3), type: "image/png" }])).json()) as {
      id: string;
      photos: { id: string; position: number }[];
    };
    aiCalls.length = 0;
    session = who;

    aiImpl = async () => ({ ok: true, text: "AI: two photos remain, a spill." });
    const removed = await removeCaseProofPhoto(id, photos[0].id);
    expect(removed.success).toBe(true);
    expect(removed.photos).toHaveLength(2);
    expect(removed.photos!.some((p) => p.id === photos[0].id)).toBe(false);
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0].images).toHaveLength(2); // the remaining set, after the removal

    // down to one photo: removing the last one is refused, and nothing changes
    await removeCaseProofPhoto(id, removed.photos![0].id);
    const last = removed.photos!.filter((p) => p.id !== removed.photos![0].id);
    expect(last).toHaveLength(1);
    const refused = await removeCaseProofPhoto(id, last[0].id);
    expect(refused).toMatchObject({ error: ar.caseProof.errors.minOnePhoto });
    expect(await prisma.caseProofPhoto.count({ where: { caseProofId: id } })).toBe(1);
  });

  it("an AI failure on add/remove clears the draft rather than leaving a stale one, and never throws", async () => {
    aiImpl = async () => ({ ok: true, text: "AI: the first draft." });
    const who = admin();
    const { id } = (await (await post(who, empA)).json()) as { id: string };
    expect((await prisma.caseProof.findUnique({ where: { id } }))!.aiDraft).toBe("AI: the first draft.");

    session = who;
    aiImpl = async () => ({ ok: false, reason: "unavailable" });
    const result = await addCaseProofPhotos(id, addForm([{ bytes: png(2), type: "image/png" }]));
    expect(result.success).toBe(true); // the photo add still succeeds
    expect(result.draft).toBeNull();
    expect(result.aiAvailable).toBe(false);
    expect(await prisma.caseProof.findUnique({ where: { id } })).toMatchObject({ aiDraft: null, aiGenerated: false });
  });

  it("the AI call throwing is handled the same way: no exception reaches the caller", async () => {
    const who = admin();
    const { id } = (await (await post(who, empA)).json()) as { id: string };
    session = who;
    aiImpl = async () => {
      throw new Error("boom");
    };
    const result = await addCaseProofPhotos(id, addForm([{ bytes: png(2), type: "image/png" }]));
    expect(result.success).toBe(true);
    expect(result.draft).toBeNull();
  });
});

describe.skipIf(!hasDb)("a refreshed AI draft never overwrites the supervisor's saved finalText", () => {
  it("after finalText is saved, adding a photo updates only aiDraft; finalText stays exactly as written", async () => {
    aiImpl = async () => ({ ok: true, text: "AI: original draft." });
    const who = supA();
    const { id } = (await (await post(who, empA)).json()) as { id: string };
    session = who;
    expect(await saveCaseProof({}, form({ id, text: "Written by the supervisor, not the AI." }))).toMatchObject({ success: true });

    aiImpl = async () => ({ ok: true, text: "AI: a fresh re-suggestion after the new photo." });
    const result = await addCaseProofPhotos(id, addForm([{ bytes: png(2), type: "image/png" }]));
    expect(result.success).toBe(true);
    expect(result.draft).toBe("AI: a fresh re-suggestion after the new photo.");

    const row = await prisma.caseProof.findUnique({ where: { id } });
    expect(row!.finalText).toBe("Written by the supervisor, not the AI."); // untouched
    expect(row!.aiDraft).toBe("AI: a fresh re-suggestion after the new photo."); // refreshed, as a suggestion only
    expect(row!.status).toBe("saved");
  });
});

describe.skipIf(!hasDb)("a legacy single-photo case (no CaseProofPhoto rows) still displays correctly", () => {
  it("loadCaseProof returns an empty photos list, which the UI falls back on for the legacy single-photo route", async () => {
    const legacy = await prisma.caseProof.create({
      data: {
        employeeId: empA,
        departmentId: deptA,
        createdById: `${TAG}-legacy`,
        createdByName: ACTOR,
        photoKey: `${TAG}-legacy.png`,
        photoMime: "image/png",
        photoSize: 1,
        status: "saved",
        finalText: "A legacy case saved before the photos table existed",
      },
    });
    expect(await prisma.caseProofPhoto.count({ where: { caseProofId: legacy.id } })).toBe(0);
    const row = await loadCaseProof(admin(), legacy.id);
    expect(row).toMatchObject({ finalText: "A legacy case saved before the photos table existed" });
    expect(row!.photos).toEqual([]);
  });

  it("the migration's backfill gives an existing single-photo case exactly one photo row, at position 0", async () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261128090000_case_proof_photos", "migration.sql"), "utf8");
    const backfill = sql.slice(sql.indexOf("INSERT IGNORE INTO")).trim().replace(/;\s*$/, "");
    const legacy = await prisma.caseProof.create({
      data: { employeeId: empA, departmentId: deptA, createdById: `${TAG}-legacy2`, createdByName: ACTOR, photoKey: `${TAG}-legacy2.png`, photoMime: "image/png", photoSize: 1, status: "saved" },
    });
    await prisma.$executeRawUnsafe(backfill);
    await prisma.$executeRawUnsafe(backfill); // safe to run twice
    const rows = await prisma.caseProofPhoto.findMany({ where: { caseProofId: legacy.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ photoKey: `${TAG}-legacy2.png`, photoMime: "image/png", position: 0 });
    const row = await loadCaseProof(admin(), legacy.id);
    expect(row!.photos).toEqual([{ id: rows[0].id, position: 0 }]);
  });
});

describe.skipIf(!hasDb)("the new migration only adds", () => {
  it("one new table and its foreign key, plus a backfill — no existing table or column is touched", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261128090000_case_proof_photos", "migration.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE|SET NULL|NO ACTION)/gi, "");
    expect(sql).toContain("CREATE TABLE `CaseProofPhoto`");
    expect(sql).toMatch(/INSERT IGNORE INTO `CaseProofPhoto`[\s\S]*FROM `CaseProof`/);
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bMODIFY\b|\bRENAME\b/i);
    const alters = sql.match(/ALTER TABLE `[A-Za-z]+`/g) ?? [];
    expect(alters.every((a) => a === "ALTER TABLE `CaseProofPhoto`")).toBe(true);
  });

  it("the old CaseProof single-photo columns are still in the schema", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const model = schema.slice(schema.indexOf("model CaseProof {"), schema.indexOf("model CaseProofEmployee"));
    expect(model).toMatch(/photoKey\s+String\b/);
    expect(model).toMatch(/photoMime\s+String\b/);
    expect(model).toMatch(/photoSize\s+Int\b/);
    expect(model).toMatch(/photos\s+CaseProofPhoto\[\]/);
  });
});

describe.skipIf(!hasDb)("access control is unchanged for the new photo actions", () => {
  it("HR, holding every grant, is still refused: cannot add or remove a photo, same as it cannot save or discard the case", async () => {
    const who = supA();
    const { id, photos } = (await (await post(who, empA)).json()) as { id: string; photos: { id: string }[] };
    session = hr();
    expect(await addCaseProofPhotos(id, addForm([{ bytes: png(2), type: "image/png" }]))).toMatchObject({ error: ar.validation.notAllowed });
    expect(await removeCaseProofPhoto(id, photos[0].id)).toMatchObject({ error: ar.validation.notAllowed });
    expect(await prisma.caseProofPhoto.count({ where: { caseProofId: id } })).toBe(1);
  });
});
