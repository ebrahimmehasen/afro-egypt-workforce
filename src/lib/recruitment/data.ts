import { prisma } from "@/lib/prisma";
import { resolveFormConfig, type FieldDef, type FormFieldRow } from "@/lib/recruitment/form-config";

// What the public pages and the internal screens read. The PUBLIC view of a job is a whitelist built here, field by field:
// nothing else on the row (applicant counts, ids of applications, notes) can reach a visitor by accident.

/** The form as it is now: defaults overridden by HR's rows. A read; nothing is written when a visitor opens the page. */
export async function loadFormConfig(): Promise<FieldDef[]> {
  const rows = await prisma.formField.findMany();
  return resolveFormConfig(rows as unknown as FormFieldRow[]);
}

export interface PublicJob {
  id: string;
  title: string;
  description: string | null;
  /** Only when HR switched "show salary" on for the job, and only the range they entered. */
  salary: { min: number | null; max: number | null } | null;
}

export async function loadOpenJobs(): Promise<PublicJob[]> {
  const jobs = await prisma.jobOpening.findMany({ where: { open: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return jobs.map((j) => ({
    id: j.id,
    title: j.title,
    description: j.description,
    salary: j.showSalary && (j.salaryMin !== null || j.salaryMax !== null) ? { min: j.salaryMin, max: j.salaryMax } : null,
  }));
}
