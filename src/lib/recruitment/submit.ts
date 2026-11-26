import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { APPLICATION_STORAGE_ROOT, checkApplicationFile, sanitizeFileName } from "@/lib/recruitment/files";
import { loadFormConfig } from "@/lib/recruitment/data";
import { allowSubmission } from "@/lib/recruitment/rate-limit";
import { validateFileFields, validateSubmission } from "@/lib/recruitment/form-config";

// The public submit, as a function: the route handler only reads the request and calls this. It creates ONE application row
// and its certificate rows, and nothing else: no employee, no payroll, no attendance, no notification to anyone's pay.

export interface SubmittedFile {
  /** The form field the file was attached to. */
  fieldKey: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export type SubmitError = "rateLimited" | "invalid" | "jobClosed" | "fileType" | "fileSize" | "fileEmpty" | "tooManyFiles";
export type SubmitResult = { ok: true; stored: boolean } | { ok: false; status: number; error: SubmitError; fields?: Record<string, string> };

export async function submitApplication(input: {
  /** Every text entry of the form except the honeypot. */
  values: Record<string, string>;
  files: SubmittedFile[];
  /** The honeypot field's value: a person leaves it empty. */
  honeypot?: string;
  ip: string;
  now?: number;
}): Promise<SubmitResult> {
  if (!allowSubmission(input.ip, input.now)) return { ok: false, status: 429, error: "rateLimited" };

  // a bot that filled the hidden field is told it worked, and nothing is stored
  if ((input.honeypot ?? "").trim() !== "") return { ok: true, stored: false };

  const config = await loadFormConfig();
  const checked = validateSubmission(config, input.values);
  if (!checked.ok) return { ok: false, status: 400, error: "invalid", fields: checked.errors };

  const counts: Record<string, number> = {};
  for (const f of input.files) counts[f.fieldKey] = (counts[f.fieldKey] ?? 0) + 1;
  const fileErrors = validateFileFields(config, counts);
  if (Object.keys(fileErrors).length > 0) return { ok: false, status: 400, error: fileErrors.files === "tooManyFiles" ? "tooManyFiles" : "invalid", fields: fileErrors };

  // a closed or unknown job answers the same way, so a visitor can't probe which ids exist
  const job = await prisma.jobOpening.findFirst({ where: { id: checked.value.jobOpeningId, open: true }, select: { id: true } });
  if (!job) return { ok: false, status: 422, error: "jobClosed" };

  const prepared: { file: SubmittedFile; ext: string; mime: string }[] = [];
  for (const file of input.files) {
    const result = checkApplicationFile(file.type, file.bytes);
    if (!result.ok) return { ok: false, status: result.error === "size" ? 413 : 415, error: result.error === "size" ? "fileSize" : result.error === "empty" ? "fileEmpty" : "fileType", fields: { [file.fieldKey]: "invalid" } };
    prepared.push({ file, ext: result.ext, mime: result.mime });
  }

  // random names under the private root: nothing in the name comes from the visitor
  await mkdir(APPLICATION_STORAGE_ROOT, { recursive: true });
  const written: string[] = [];
  const documents: { fieldKey: string; fileName: string; storageKey: string; mimeType: string; size: number }[] = [];
  try {
    for (const p of prepared) {
      const storageKey = `${randomUUID()}.${p.ext}`;
      await writeFile(path.join(APPLICATION_STORAGE_ROOT, storageKey), p.file.bytes, { flag: "wx" });
      written.push(storageKey);
      documents.push({ fieldKey: p.file.fieldKey, fileName: sanitizeFileName(p.file.name), storageKey, mimeType: p.mime, size: p.file.bytes.length });
    }
    const v = checked.value;
    await prisma.jobApplication.create({
      data: {
        jobOpeningId: v.jobOpeningId,
        fullName: v.fullName,
        phone: v.phone,
        email: v.email,
        nationalId: v.nationalId,
        birthDate: v.birthDate,
        city: v.city,
        education: v.education,
        experience: v.experience,
        expectedSalary: v.expectedSalary,
        answers: v.answers.length > 0 ? v.answers : undefined,
        documents: { create: documents },
      },
    });
  } catch (error) {
    await Promise.all(written.map((key) => unlink(path.join(APPLICATION_STORAGE_ROOT, key)).catch(() => undefined)));
    throw error;
  }
  return { ok: true, stored: true };
}

