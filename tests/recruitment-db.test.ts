import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { User } from "@/lib/types";
import { ar } from "@/lib/i18n/dictionaries/ar";

/**
 * The public application form and what HR does with it, on real rows of the disposable TEST database (skipped anywhere
 * else: tests never use the production database, see tests/setup/db-guard.ts). The public submit: valid, missing fields,
 * bad type, oversize, honeypot, rate limit, a closed job, a hidden field, a custom question, salary shown only when HR says.
 * The internal side: only the admin and HR with the employees grant may edit jobs, the form, an application, or download a file.
 */
let session: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { submitApplication } = await import("@/lib/recruitment/submit");
const { resetSubmissionLimits } = await import("@/lib/recruitment/rate-limit");
const { loadOpenJobs, loadFormConfig } = await import("@/lib/recruitment/data");
const { APPLICATION_STORAGE_ROOT } = await import("@/lib/recruitment/files");
const { RECRUITMENT_LIMITS: L } = await import("@/lib/recruitment/config");
const { updateApplication, saveJob, saveFormField, addFormQuestion, removeFormQuestion, moveFormField } = await import("@/lib/actions/recruitment");
const { GET: downloadDocument } = await import("@/app/api/applications/[id]/documents/[docId]/route");
const { POST: submitRoute } = await import("@/app/api/apply/route");

const prisma = new PrismaClient();
let hasDb = false;
try {
  hasDb = (await prisma.jobOpening.count()) >= 0 && (await prisma.formField.count()) >= 0;
} catch {
  hasDb = false;
}

const TAG = "ZZ-RECRUIT";
const ACTOR = `${TAG}-actor`;
const user = (over: Partial<User>): User => ({ id: "U-rec", name: ACTOR, email: "r@x", role: "admin", permissions: [], ...over });
const admin = () => user({ role: "admin" });
const hrWithGrant = () => user({ role: "hr", permissions: ["employees"] });

const pdf = (extra = 10) => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(extra).fill(0x41)]);
const base = { fullName: "Hossam Ali", phone: "01012345678", education: "Diploma" };
const submit = (jobId: string, values: Record<string, string> = {}, files: { fieldKey: string; name: string; type: string; bytes: Uint8Array }[] = [], over: { honeypot?: string; ip?: string } = {}) =>
  submitApplication({ values: { job: jobId, ...base, ...values }, files, ip: over.ip ?? "203.0.113.7", honeypot: over.honeypot });

let openJob = "";
let closedJob = "";
let salaryHiddenJob = "";
let salaryShownJob = "";
const storedKeys = new Set<string>();

async function cleanup() {
  const jobs = await prisma.jobOpening.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } });
  const docs = await prisma.applicationDocument.findMany({ where: { application: { jobOpeningId: { in: jobs.map((j) => j.id) } } } });
  for (const d of docs) storedKeys.add(d.storageKey);
  await prisma.jobApplication.deleteMany({ where: { jobOpeningId: { in: jobs.map((j) => j.id) } } });
  await prisma.jobOpening.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.formField.deleteMany({});
  await prisma.auditLogEntry.deleteMany({ where: { userName: ACTOR } });
  for (const key of storedKeys) await unlink(path.join(APPLICATION_STORAGE_ROOT, key)).catch(() => undefined);
}

beforeAll(async () => {
  if (!hasDb) return;
  await cleanup();
  const mk = (title: string, over: Record<string, unknown>) => prisma.jobOpening.create({ data: { title: `${TAG} ${title}`, ...over } }).then((j) => j.id);
  openJob = await mk("open", { open: true });
  closedJob = await mk("closed", { open: false });
  salaryHiddenJob = await mk("salary hidden", { open: true, salaryMin: 5000, salaryMax: 7000, showSalary: false });
  salaryShownJob = await mk("salary shown", { open: true, salaryMin: 5000, salaryMax: 7000, showSalary: true });
});

afterAll(async () => {
  if (hasDb) await cleanup();
  await prisma.$disconnect();
});

beforeEach(() => {
  resetSubmissionLimits();
  session = null;
});

const applications = (jobId: string) => prisma.jobApplication.findMany({ where: { jobOpeningId: jobId }, include: { documents: true } });

describe.skipIf(!hasDb)("the public submit", () => {
  it("stores a valid application with its certificate: a random key under the private root, never the visitor's name", async () => {
    const r = await submit(openJob, { email: "h@x.com", city: "Cairo" }, [{ fieldKey: "certificates", name: "../../my cert <1>.pdf", type: "application/pdf", bytes: pdf() }]);
    expect(r).toEqual({ ok: true, stored: true });
    const [app] = await applications(openJob);
    expect(app).toMatchObject({ fullName: "Hossam Ali", phone: "01012345678", email: "h@x.com", status: "new", education: "Diploma" });
    expect(app.documents).toHaveLength(1);
    const doc = app.documents[0];
    expect(doc).toMatchObject({ mimeType: "application/pdf", fieldKey: "certificates", size: pdf().length });
    expect(doc.fileName).not.toMatch(/[\\/<>]/);
    expect(doc.storageKey).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(doc.storageKey).not.toContain("cert");
    expect(existsSync(path.join(APPLICATION_STORAGE_ROOT, doc.storageKey))).toBe(true);
    expect(APPLICATION_STORAGE_ROOT.split(path.sep)).not.toContain("public");
    expect(await readFile(path.join(APPLICATION_STORAGE_ROOT, doc.storageKey))).toEqual(Buffer.from(pdf()));
  });

  it("creates no employee, user or login: one application row, and nothing else of that name", async () => {
    const name = "ZZ Applicant Probe";
    const apps = (await applications(openJob)).length;
    expect(await submit(openJob, { fullName: name, email: "probe@zz-recruit.example" })).toMatchObject({ ok: true });
    expect((await applications(openJob)).length).toBe(apps + 1);
    expect(await prisma.employee.count({ where: { name } })).toBe(0);
    expect(await prisma.user.count({ where: { OR: [{ name }, { email: "probe@zz-recruit.example" }] } })).toBe(0);
  });

  it("refuses missing required fields, and stores nothing", async () => {
    const count = (await applications(openJob)).length;
    const r = await submitApplication({ values: { job: openJob }, files: [], ip: "203.0.113.8" });
    expect(r).toMatchObject({ ok: false, status: 400, error: "invalid" });
    expect(!r.ok && r.fields).toMatchObject({ fullName: "required", phone: "required", education: "required" });
    expect((await applications(openJob)).length).toBe(count);
  });

  it("refuses a file that is not a pdf, jpg or png, and one that only claims to be: nothing stored, nothing on disk", async () => {
    const count = (await applications(openJob)).length;
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    expect(await submit(openJob, {}, [{ fieldKey: "certificates", name: "x.exe", type: "application/x-msdownload", bytes: exe }])).toMatchObject({ ok: false, status: 415, error: "fileType" });
    expect(await submit(openJob, {}, [{ fieldKey: "certificates", name: "x.pdf", type: "application/pdf", bytes: exe }])).toMatchObject({ ok: false, status: 415, error: "fileType" });
    expect((await applications(openJob)).length).toBe(count);
  });

  it("refuses an oversize file", async () => {
    const big = pdf(L.maxFileBytes);
    expect(await submit(openJob, {}, [{ fieldKey: "certificates", name: "big.pdf", type: "application/pdf", bytes: big }])).toMatchObject({ ok: false, status: 413, error: "fileSize" });
  });

  it("refuses too many files", async () => {
    const files = Array.from({ length: L.maxFiles + 1 }, (_, i) => ({ fieldKey: "certificates", name: `${i}.pdf`, type: "application/pdf", bytes: pdf() }));
    expect(await submit(openJob, {}, files)).toMatchObject({ ok: false, error: "tooManyFiles" });
  });

  it("the honeypot: a filled hidden field looks like success but stores nothing", async () => {
    const count = (await applications(openJob)).length;
    expect(await submit(openJob, {}, [], { honeypot: "http://spam.example" })).toEqual({ ok: true, stored: false });
    expect((await applications(openJob)).length).toBe(count);
  });

  it("the rate limit: one address gets a few, then 429; another address is unaffected", async () => {
    for (let i = 0; i < L.perIpLimit; i++) expect(await submit(openJob, {}, [], { ip: "198.51.100.1" })).toMatchObject({ ok: true });
    expect(await submit(openJob, {}, [], { ip: "198.51.100.1" })).toMatchObject({ ok: false, status: 429, error: "rateLimited" });
    expect(await submit(openJob, {}, [], { ip: "198.51.100.2" })).toMatchObject({ ok: true });
  });

  it("a closed job, or one that does not exist, cannot receive an application (and answers the same)", async () => {
    const closed = await submit(closedJob);
    const missing = await submit("no-such-job");
    expect(closed).toMatchObject({ ok: false, status: 422, error: "jobClosed" });
    expect(missing).toEqual(closed);
    expect(await applications(closedJob)).toEqual([]);
  });

  it("the route: an oversize body is refused before it is read, and an ordinary post works with no session at all", async () => {
    const huge = new Request("http://localhost/api/apply", { method: "POST", headers: { "content-length": String(L.maxRequestBytes + 1), "content-type": "multipart/form-data; boundary=x" }, body: "x" });
    expect((await submitRoute(huge as never)).status).toBe(413);

    const form = new FormData();
    form.set("job", openJob);
    for (const [k, v] of Object.entries(base)) form.set(k, v);
    form.set("certificates", new Blob([pdf()], { type: "application/pdf" }), "cert.pdf");
    const res = await submitRoute(new Request("http://localhost/api/apply", { method: "POST", body: form, headers: { "x-forwarded-for": "192.0.2.50" } }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true }); // no id, no echo
  });
});

describe.skipIf(!hasDb)("a form HR has customised", () => {
  it("a hidden default field is rejected by the server, even if the browser posts it", async () => {
    await saveFieldAs(admin(), { key: "email", labelAr: "بريد", labelEn: "Email", visible: "", required: "" });
    const r = await submit(openJob, { email: "h@x.com" });
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    expect(!r.ok && r.fields).toEqual({ email: "hiddenField" });
    expect(await submit(openJob)).toMatchObject({ ok: true }); // and the form still works without it
  });

  it("a custom required question is enforced, validated and stored with the application, shown with its labels", async () => {
    session = admin();
    const f = new FormData();
    f.set("labelAr", "عندك خبرة في المصانع؟");
    f.set("labelEn", "Factory experience?");
    f.set("type", "select");
    f.set("required", "on");
    f.set("optionsText", "نعم | Yes\nلا | No");
    expect(await addFormQuestion({}, f)).toMatchObject({ success: true });
    const question = (await loadFormConfig()).find((x) => x.custom)!;
    expect(question).toMatchObject({ type: "select", required: true, visible: true });

    expect(await submit(openJob)).toMatchObject({ ok: false, fields: { [question.key]: "required" } });
    expect(await submit(openJob, { [question.key]: "zzz" })).toMatchObject({ ok: false, fields: { [question.key]: "invalid" } });
    expect(await submit(openJob, { [question.key]: question.options[0].value }, [], { ip: "192.0.2.77" })).toMatchObject({ ok: true });
    const stored = (await applications(openJob)).find((a) => Array.isArray(a.answers) && a.answers.length > 0)!;
    expect(stored.answers).toEqual([{ key: question.key, labelAr: "عندك خبرة في المصانع؟", labelEn: "Factory experience?", value: "نعم" }]);

    // removing the question later leaves the stored answer (with its snapshot labels) alone
    expect(await removeFormQuestion(question.key)).toMatchObject({ success: true });
    expect((await loadFormConfig()).some((x) => x.key === question.key)).toBe(false);
    expect((await prisma.jobApplication.findUnique({ where: { id: stored.id } }))!.answers).toEqual(stored.answers);
  });
});

async function saveFieldAs(who: User, fields: Record<string, string>) {
  session = who;
  const f = new FormData();
  // like the real form: the field keeps the place it already has
  f.set("sortOrder", String((await loadFormConfig()).find((x) => x.key === fields.key)?.sortOrder ?? 0));
  for (const [k, v] of Object.entries(fields)) if (v !== "") f.set(k, v);
  return saveFormField({}, f);
}

describe.skipIf(!hasDb)("what the public sees of a job", () => {
  it("shows the salary only where HR switched it on, and only the range", async () => {
    const jobs = await loadOpenJobs();
    const find = (id: string) => jobs.find((j) => j.id === id)!;
    expect(find(salaryHiddenJob).salary).toBeNull();
    expect(find(salaryShownJob).salary).toEqual({ min: 5000, max: 7000 });
  });

  it("lists open jobs only, and exposes nothing but id, title, description and the salary", async () => {
    const jobs = await loadOpenJobs();
    expect(jobs.some((j) => j.id === closedJob)).toBe(false);
    expect(jobs.some((j) => j.id === openJob)).toBe(true);
    for (const j of jobs) expect(Object.keys(j).sort()).toEqual(["description", "id", "salary", "title"]);
  });
});

describe.skipIf(!hasDb)("who may change jobs, the form and applications", () => {
  const jobForm = (title: string) => {
    const f = new FormData();
    f.set("title", title);
    f.set("open", "on");
    f.set("salaryMin", "4000");
    f.set("salaryMax", "9000");
    return f;
  };

  it("anonymous, an employee, a supervisor and HR without the grant are all refused, and nothing is written", async () => {
    const before = await prisma.jobOpening.count({ where: { title: { startsWith: `${TAG} blocked` } } });
    for (const who of [null, user({ role: "employee" }), user({ role: "supervisor", permissions: ["employees"] }), user({ role: "hr", permissions: ["leaves"] }), user({ role: "hr", permissions: [] }), user({ role: "staff", permissions: ["employees"] })]) {
      session = who;
      expect(await saveJob({}, jobForm(`${TAG} blocked`)), String(who?.role)).toEqual({ error: ar.validation.notAllowed });
      expect(await saveFormField({}, new FormData())).toEqual({ error: ar.validation.notAllowed });
      expect(await addFormQuestion({}, new FormData())).toEqual({ error: ar.validation.notAllowed });
      expect(await removeFormQuestion("q_abcd1234")).toEqual({ error: ar.validation.notAllowed });
      expect(await moveFormField("email", "up")).toEqual({ error: ar.validation.notAllowed });
      expect(await updateApplication({}, new FormData())).toEqual({ error: ar.validation.notAllowed });
    }
    expect(await prisma.jobOpening.count({ where: { title: { startsWith: `${TAG} blocked` } } })).toBe(before);
  });

  it("the admin and HR with the employees grant may add a job, with an audit entry", async () => {
    for (const who of [admin(), hrWithGrant()]) {
      session = who;
      expect(await saveJob({}, jobForm(`${TAG} made by ${who.role}`))).toMatchObject({ success: true });
    }
    expect(await prisma.jobOpening.count({ where: { title: { startsWith: `${TAG} made by` } } })).toBe(2);
    expect(await prisma.auditLogEntry.count({ where: { userName: ACTOR, action: ar.auditActions.createJob } })).toBe(2);
  });

  it("a job's salary range must be in order", async () => {
    session = admin();
    const f = jobForm(`${TAG} bad range`);
    f.set("salaryMin", "9000");
    f.set("salaryMax", "4000");
    expect(await saveJob({}, f)).toMatchObject({ error: ar.recruitment.admin.jobs.salaryOrder });
  });

  it("the core fields cannot be hidden, made optional or removed, whatever is posted", async () => {
    for (const key of ["job", "fullName", "phone"]) {
      expect(await saveFieldAs(admin(), { key, labelAr: "تسمية", labelEn: "Label", visible: "", required: "" })).toMatchObject({ success: true });
      expect((await loadFormConfig()).find((f) => f.key === key)).toMatchObject({ visible: true, required: true, builtin: true, labelEn: "Label" });
      expect(await removeFormQuestion(key)).toEqual({ error: ar.validation.notAllowed });
      expect(await prisma.formField.findUnique({ where: { key } })).toMatchObject({ visible: true, required: true, builtin: true });
    }
    expect(await removeFormQuestion("email")).toEqual({ error: ar.validation.notAllowed }); // a default is hidden, never deleted
  });

  it("a field can be relabelled, made required and moved; the order is rewritten", async () => {
    expect(await saveFieldAs(hrWithGrant(), { key: "city", labelAr: "المحافظة", labelEn: "Governorate", visible: "on", required: "on" })).toMatchObject({ success: true });
    expect((await loadFormConfig()).find((f) => f.key === "city")).toMatchObject({ labelAr: "المحافظة", labelEn: "Governorate", required: true });
    const before = (await loadFormConfig()).map((f) => f.key);
    session = admin();
    expect(await moveFormField("city", "up")).toMatchObject({ success: true });
    const after = (await loadFormConfig()).map((f) => f.key);
    expect(after.indexOf("city")).toBe(before.indexOf("city") - 1);
    expect(after.filter((k) => k !== "city" && k !== before[before.indexOf("city") - 1])).toEqual(before.filter((k) => k !== "city" && k !== before[before.indexOf("city") - 1]));
  });

  it("changing an application's status and note is audited, and only for admin or HR with the grant", async () => {
    const [app] = await applications(openJob);
    session = user({ role: "supervisor", permissions: ["employees"] });
    const f = new FormData();
    f.set("id", app.id);
    f.set("status", "shortlisted");
    f.set("note", "good candidate");
    expect(await updateApplication({}, f)).toEqual({ error: ar.validation.notAllowed });
    expect((await prisma.jobApplication.findUnique({ where: { id: app.id } }))!.status).toBe("new");

    session = hrWithGrant();
    expect(await updateApplication({}, f)).toMatchObject({ success: true });
    expect(await prisma.jobApplication.findUnique({ where: { id: app.id } })).toMatchObject({ status: "shortlisted", note: "good candidate" });
    expect(await prisma.auditLogEntry.count({ where: { userName: ACTOR, action: ar.auditActions.updateApplication } })).toBe(1);

    f.set("status", "employed-already");
    expect(await updateApplication({}, f)).toEqual({ error: ar.validation.invalidData });
  });
});

describe.skipIf(!hasDb)("the certificate download", () => {
  let appId = "";
  let docId = "";
  beforeAll(async () => {
    await mkdir(APPLICATION_STORAGE_ROOT, { recursive: true });
    const key = `${TAG}-fixture.pdf`;
    storedKeys.add(key);
    await writeFile(path.join(APPLICATION_STORAGE_ROOT, key), pdf());
    const app = await prisma.jobApplication.create({
      data: { jobOpeningId: openJob, fullName: "Download Test", phone: "01000000000", education: "x", documents: { create: { fieldKey: "certificates", fileName: "شهادة.pdf", storageKey: key, mimeType: "application/pdf", size: pdf().length } } },
      include: { documents: true },
    });
    appId = app.id;
    docId = app.documents[0].id;
  });
  const get = (id = appId, doc = docId) => downloadDocument(new Request("http://localhost/x") as never, { params: Promise.resolve({ id, docId: doc }) });

  it("anonymous: 401; an employee, a supervisor, HR without the grant: 403", async () => {
    session = null;
    expect((await get()).status).toBe(401);
    for (const who of [user({ role: "employee" }), user({ role: "supervisor", permissions: ["employees"] }), user({ role: "hr", permissions: ["leaves"] })]) {
      session = who;
      expect((await get()).status, who.role).toBe(403);
    }
  });

  it("admin and HR with the grant get the file as a download, with a fixed type and no sniffing", async () => {
    for (const who of [admin(), hrWithGrant()]) {
      session = who;
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("sandbox");
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(pdf()));
    }
  });

  it("a document id under another application, or an unknown one, is not served", async () => {
    session = admin();
    const other = (await applications(openJob)).find((a) => a.id !== appId)!;
    expect((await get(other.id, docId)).status).toBe(404);
    expect((await get(appId, "nope")).status).toBe(404);
  });
});
