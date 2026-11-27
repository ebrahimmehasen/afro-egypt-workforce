import { prisma } from "@/lib/prisma";

// Employee evaluation: read-only reference data for a manager, with zero effect on anything a paycheck or an
// attendance day depends on. Nothing here is imported by, or imports, payroll/deduction/overtime/attendance-
// calculation code (pay-engine.ts, attendance-engine.ts, attendance-deductions.ts, payroll-engine.ts, ...).

export interface JobLevelOption {
  id: string;
  name: string;
  sortOrder: number;
}

export interface RatingScaleOption {
  id: string;
  label: string;
  sortOrder: number;
}

/** Active job levels, in display order. No salary range, no pay link — purely a label an admin defined. */
export async function loadJobLevels(): Promise<JobLevelOption[]> {
  const rows = await prisma.jobLevel.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sortOrder }));
}

/** Active rating-scale items, in display order. Labels and order only come from here — never hardcoded. */
export async function loadRatingScale(): Promise<RatingScaleOption[]> {
  const rows = await prisma.evaluationScaleItem.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, label: r.label, sortOrder: r.sortOrder }));
}

export interface SeverityCounts {
  small: number;
  medium: number;
  large: number;
  /** Sum of estimatedLossPercent across this employee's saved cases that set it (null ones are skipped, not zero). */
  estimatedLossPercentSum: number;
}

export interface EvaluationListRow {
  employeeId: string;
  name: string;
  employeeNumber: string;
  departmentId: string;
  departmentName: string;
  jobLevel: { id: string; name: string } | null;
  latestRating: { id: string; label: string } | null;
  caseCount: number;
  severity: SeverityCounts;
}

const emptySeverity: SeverityCounts = { small: 0, medium: 0, large: 0, estimatedLossPercentSum: 0 };

/**
 * One row per active, non-deleted employee: current job level (the most recent EmployeeLevelChange), latest
 * performance rating (the most recent EvaluationReview), and a summary of their saved case-proofs. No combined
 * score and no ranking are computed — the caller never sorts these into a league table.
 */
export async function loadEvaluationRows(): Promise<EvaluationListRow[]> {
  const [employees, levelChanges, reviews, links] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, name: true, employeeNumber: true, departmentId: true, department: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.employeeLevelChange.findMany({ orderBy: { createdAt: "desc" }, include: { jobLevel: { select: { id: true, name: true } } } }),
    prisma.evaluationReview.findMany({ orderBy: { createdAt: "desc" }, include: { scaleItem: { select: { id: true, label: true } } } }),
    prisma.caseProofEmployee.findMany({ where: { caseProof: { status: "saved" } }, select: { employeeId: true, caseProof: { select: { severity: true, estimatedLossPercent: true } } } }),
  ]);

  const latestLevelByEmployee = new Map<string, { id: string; name: string }>();
  for (const c of levelChanges) if (!latestLevelByEmployee.has(c.employeeId)) latestLevelByEmployee.set(c.employeeId, c.jobLevel);

  const latestRatingByEmployee = new Map<string, { id: string; label: string }>();
  for (const r of reviews) if (!latestRatingByEmployee.has(r.employeeId)) latestRatingByEmployee.set(r.employeeId, r.scaleItem);

  const severityByEmployee = new Map<string, SeverityCounts>();
  for (const l of links) {
    const cur = severityByEmployee.get(l.employeeId) ?? { ...emptySeverity };
    if (l.caseProof.severity) cur[l.caseProof.severity] += 1;
    if (l.caseProof.estimatedLossPercent != null) cur.estimatedLossPercentSum += l.caseProof.estimatedLossPercent;
    severityByEmployee.set(l.employeeId, cur);
  }
  const caseCountByEmployee = new Map<string, number>();
  for (const l of links) caseCountByEmployee.set(l.employeeId, (caseCountByEmployee.get(l.employeeId) ?? 0) + 1);

  return employees.map((e) => ({
    employeeId: e.id,
    name: e.name,
    employeeNumber: e.employeeNumber,
    departmentId: e.departmentId,
    departmentName: e.department.name,
    jobLevel: latestLevelByEmployee.get(e.id) ?? null,
    latestRating: latestRatingByEmployee.get(e.id) ?? null,
    caseCount: caseCountByEmployee.get(e.id) ?? 0,
    severity: severityByEmployee.get(e.id) ?? emptySeverity,
  }));
}

export interface LevelHistoryRow {
  id: string;
  jobLevelName: string;
  reason: string;
  changedByName: string;
  createdAt: Date;
}

export interface EvaluationReviewRow {
  id: string;
  periodLabel: string;
  periodDate: Date;
  ratingLabel: string;
  comment: string | null;
  createdByName: string;
  createdAt: Date;
}

export interface EmployeeDocumentLink {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  /** Through the existing authorized route — never a copy, never new storage. */
  url: string;
}

export interface CaseHistoryRow {
  id: string;
  createdAt: Date;
  severity: "small" | "medium" | "large" | null;
  estimatedLossPercent: number | null;
  /** The supervisor's saved record — never the AI's own suggestion text. */
  text: string | null;
  photoUrls: string[];
}

export interface EmployeeEvaluationDetail {
  employee: { id: string; name: string; employeeNumber: string; departmentName: string; jobTitle: string; hireDate: Date; phone: string | null; nationalId: string | null };
  /// Certificates: every EmployeeDocument, plus the linked application's ApplicationDocument rows, if a link exists.
  certificates: EmployeeDocumentLink[];
  /// Experience certificate + work-experience-certificate documents, plus the linked application's free-text experience.
  previousExperience: { documents: EmployeeDocumentLink[]; applicationText: string | null };
  currentJobLevel: { id: string; name: string } | null;
  levelHistory: LevelHistoryRow[];
  evaluations: EvaluationReviewRow[];
  caseHistory: CaseHistoryRow[];
}

/**
 * A hired applicant's own record, when one exists for this employee. There is no formal column linking an
 * Employee to the JobApplication it came from — the national ID both carry is the one fact the two models
 * already share, so a "hired" application with the same ID is read as that link. Never guessed otherwise:
 * no match, no link, nothing shown.
 */
async function findLinkedApplication(nationalId: string | null) {
  if (!nationalId) return null;
  return prisma.jobApplication.findFirst({
    where: { nationalId, status: "hired" },
    orderBy: { createdAt: "desc" },
    include: { documents: true },
  });
}

const EXPERIENCE_DOCUMENT_TYPES = ["experience_certificate", "work_experience_certificate"] as const;

export async function loadEmployeeEvaluationDetail(employeeId: string): Promise<EmployeeEvaluationDetail | null> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { id: true, name: true, employeeNumber: true, jobTitle: true, hireDate: true, phone: true, nationalId: true, department: { select: { name: true } } },
  });
  if (!employee) return null;

  const [documents, levelChanges, reviews, caseLinks, linkedApplication] = await Promise.all([
    prisma.employeeDocument.findMany({ where: { employeeId }, orderBy: { uploadedAt: "desc" } }),
    prisma.employeeLevelChange.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, include: { jobLevel: { select: { id: true, name: true } } } }),
    prisma.evaluationReview.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, include: { scaleItem: { select: { label: true } } } }),
    prisma.caseProofEmployee.findMany({
      where: { employeeId, caseProof: { status: "saved" } },
      orderBy: { caseProof: { createdAt: "desc" } },
      include: { caseProof: { include: { photos: { select: { id: true }, orderBy: { position: "asc" } } } } },
    }),
    findLinkedApplication(employee.nationalId),
  ]);

  const docLink = (d: { id: string; fileName: string | null; mimeType: string | null }): EmployeeDocumentLink => ({
    id: d.id,
    fileName: d.fileName,
    mimeType: d.mimeType,
    url: `/api/employees/${employeeId}/documents?docId=${encodeURIComponent(d.id)}`,
  });
  const appDocLink = (d: { id: string; fileName: string; mimeType: string }): EmployeeDocumentLink => ({
    id: d.id,
    fileName: d.fileName,
    mimeType: d.mimeType,
    url: `/api/applications/${linkedApplication!.id}/documents/${encodeURIComponent(d.id)}`,
  });

  const certificates: EmployeeDocumentLink[] = [...documents.map(docLink), ...(linkedApplication?.documents.map(appDocLink) ?? [])];

  const experienceDocs = documents.filter((d) => (EXPERIENCE_DOCUMENT_TYPES as readonly string[]).includes(d.type)).map(docLink);

  return {
    employee: {
      id: employee.id,
      name: employee.name,
      employeeNumber: employee.employeeNumber,
      departmentName: employee.department.name,
      jobTitle: employee.jobTitle,
      hireDate: employee.hireDate,
      phone: employee.phone,
      nationalId: employee.nationalId,
    },
    certificates,
    previousExperience: { documents: experienceDocs, applicationText: linkedApplication?.experience ?? null },
    currentJobLevel: levelChanges[0]?.jobLevel ?? null,
    levelHistory: levelChanges.map((c) => ({ id: c.id, jobLevelName: c.jobLevel.name, reason: c.reason, changedByName: c.changedByName, createdAt: c.createdAt })),
    evaluations: reviews.map((r) => ({ id: r.id, periodLabel: r.periodLabel, periodDate: r.periodDate, ratingLabel: r.scaleItem.label, comment: r.comment, createdByName: r.createdByName, createdAt: r.createdAt })),
    caseHistory: caseLinks.map((l) => ({
      id: l.caseProof.id,
      createdAt: l.caseProof.createdAt,
      severity: l.caseProof.severity,
      estimatedLossPercent: l.caseProof.estimatedLossPercent,
      text: l.caseProof.finalText,
      photoUrls:
        l.caseProof.photos.length > 0
          ? l.caseProof.photos.map((p) => `/api/case-proof/${l.caseProof.id}/photos/${p.id}`)
          : [`/api/case-proof/${l.caseProof.id}/photo`],
    })),
  };
}
