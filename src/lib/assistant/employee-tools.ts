import type { Store } from "@/lib/store";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Employee, EmployeeDocumentType } from "@/lib/types";
import { missingDocumentTypes, requiredDocumentTypes } from "@/lib/documents";

// The read-only tools the assistant can call. Every one works on a Store that has already been narrowed to
// what the asking user may see (see scopedSnapshot), never on the database directly, and none of them
// returns an internal id — people are always identified by employee number.

export type Locale = "ar" | "en";

export interface ToolContext {
  db: Store;
  t: Dictionary;
  locale: Locale;
  /** yyyy-MM-dd */
  today: string;
}

/** The placeholder department newly imported employees sit in until HR assigns a real one. */
export const UNASSIGNED_DEPARTMENT = "غير محدد";

const FIELD_LABELS: Record<Locale, Record<string, string>> = {
  ar: {
    nationalId: "الرقم القومي",
    phone: "رقم التليفون",
    address: "العنوان",
    qualification: "المؤهل الدراسي",
    salary: "المرتب",
    department: "القسم",
    jobTitle: "الوظيفة",
    biometric: "التسجيل على جهاز البصمة",
  },
  en: {
    nationalId: "National ID",
    phone: "Phone",
    address: "Address",
    qualification: "Qualification",
    salary: "Salary",
    department: "Department",
    jobTitle: "Job title",
    biometric: "Fingerprint device registration",
  },
};

const MAX_LIST = 40;

// ---------------------------------------------------------------------------------------------------
// Tool definitions (OpenAI-compatible function schema)
// ---------------------------------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_employees",
      description:
        "Find employees by name, employee number, job title, department or status, or list a group of them. Returns basic info only; call get_employee for someone's full file.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, employee number or job title (partial match is fine)." },
          department: { type: "string", description: "Department name (partial match is fine)." },
          status: { type: "string", enum: ["active", "on_leave", "terminated"] },
          limit: { type: "integer", description: "Max rows, default 15." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_employee",
      description:
        "The full file of ONE employee: identity, personal data (national ID, phone, address), pay, documents on file and missing, details still missing, recent attendance, leaves, overtime and deductions.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Employee number (e.g. PROD-001) or the name." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_missing_items",
      description:
        "Employees ranked by how complete their records are: missing required documents, missing profile data (national ID, phone, address, qualification, salary, department, fingerprint registration) and how many document files they have. Includes company-wide totals. Use sort to get the right end of the list.",
      parameters: {
        type: "object",
        properties: {
          department: { type: "string", description: "Limit to one department (optional)." },
          limit: { type: "integer", description: "Max employees to list, default 25." },
          sort: {
            type: "string",
            enum: ["most_missing", "fewest_missing", "fewest_files", "most_files"],
            description:
              "most_missing (default): the most incomplete first. fewest_missing: the most complete first. fewest_files: the fewest document files on file first. most_files: the most document files first.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "company_overview",
      description:
        "A snapshot of the whole company: headcount by status and department, salary totals and averages, recent hires, document completeness, data-quality problems and 30-day attendance highlights.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["function"]["name"];

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase();
const contains = (haystack: string | undefined, needle: string) => (haystack ?? "").toLowerCase().includes(needle);

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()));
}

function deptName(ctx: ToolContext, e: Employee): string {
  return ctx.db.departments.find((d) => d.id === e.departmentId)?.name ?? UNASSIGNED_DEPARTMENT;
}

function docLabel(ctx: ToolContext, type: EmployeeDocumentType): string {
  return ctx.t.documents.types[type];
}

/**
 * People are named in answers, not numbered, so the model is not shown employee numbers in lists: it can't
 * repeat what it never saw. A number goes out only for someone who shares a name with another employee, where
 * it is the only way to tell them apart, and in a single person's own file.
 */
function codeIfNeeded(ctx: ToolContext, e: Employee): { employeeNumber?: string } {
  const sameName = ctx.db.employees.filter((x) => norm(x.name) === norm(e.name)).length > 1;
  return sameName ? { employeeNumber: e.employeeNumber } : {};
}

const salaryMissing = (e: Employee) => (e.salaryType === "daily" ? !(e.dailyRate && e.dailyRate > 0) : !(e.basicSalary > 0));

/** The profile fields an employee is still missing, as readable labels. */
export function missingProfileFields(ctx: ToolContext, e: Employee): string[] {
  const L = FIELD_LABELS[ctx.locale];
  const out: string[] = [];
  if (!e.nationalId) out.push(L.nationalId);
  if (!e.phone) out.push(L.phone);
  if (!e.address) out.push(L.address);
  if (!e.qualification) out.push(L.qualification);
  if (salaryMissing(e)) out.push(L.salary);
  if (deptName(ctx, e) === UNASSIGNED_DEPARTMENT) out.push(L.department);
  if (!e.jobTitle || e.jobTitle === UNASSIGNED_DEPARTMENT) out.push(L.jobTitle);
  if (!e.biometricDeviceUserId) out.push(L.biometric);
  return out;
}

function documentsFor(ctx: ToolContext, e: Employee) {
  const docs = ctx.db.employeeDocuments.filter((d) => d.employeeId === e.id);
  const required = requiredDocumentTypes(e);
  const missing = missingDocumentTypes(docs, required);
  const byType = new Map<EmployeeDocumentType, number>();
  for (const d of docs) byType.set(d.type, (byType.get(d.type) ?? 0) + 1);
  return { docs, required, missing, byType };
}

// ---------------------------------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------------------------------

export function searchEmployees(ctx: ToolContext, args: { query?: string; department?: string; status?: string; limit?: number }) {
  const q = args.query ? norm(args.query) : "";
  const dep = args.department ? norm(args.department) : "";
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), MAX_LIST);

  const matches = ctx.db.employees.filter((e) => {
    if (args.status && e.status !== args.status) return false;
    if (dep && !contains(deptName(ctx, e), dep)) return false;
    if (q && !(contains(e.name, q) || contains(e.employeeNumber, q) || contains(e.jobTitle, q))) return false;
    return true;
  });

  return {
    total: matches.length,
    showing: Math.min(matches.length, limit),
    employees: matches.slice(0, limit).map((e) => ({
      ...codeIfNeeded(ctx, e),
      name: e.name,
      department: deptName(ctx, e),
      jobTitle: e.jobTitle,
      status: e.status,
      hireDate: e.hireDate,
    })),
  };
}

function resolveEmployee(ctx: ToolContext, query: string): { one?: Employee; candidates?: Employee[] } {
  const q = norm(query);
  const exact = ctx.db.employees.find((e) => norm(e.employeeNumber) === q);
  if (exact) return { one: exact };
  const byName = ctx.db.employees.filter((e) => contains(e.name, q));
  if (byName.length === 1) return { one: byName[0] };
  const sameName = byName.filter((e) => norm(e.name) === q);
  if (sameName.length === 1) return { one: sameName[0] };
  return { candidates: byName };
}

export function getEmployee(ctx: ToolContext, args: { query?: string }) {
  if (!args.query?.trim()) return { error: "query is required" };
  const { one, candidates } = resolveEmployee(ctx, args.query);
  if (!one) {
    if (!candidates?.length) return { found: false, message: "No employee matches that name or number in the records you can access." };
    return {
      found: false,
      ambiguous: true,
      message: "More than one employee matches — ask which one, or use the employee number.",
      candidates: candidates.slice(0, 10).map((e) => ({ employeeNumber: e.employeeNumber, name: e.name, department: deptName(ctx, e) })),
    };
  }

  const e = one;
  const { db, today } = ctx;
  const shift = db.shifts.find((s) => s.id === e.shiftId);
  const { docs, required, missing, byType } = documentsFor(ctx, e);

  const since30 = addDays(today, -30);
  const attendance = db.dailyAttendance.filter((a) => a.employeeId === e.id && a.date >= since30 && a.date <= today);
  const byStatus: Record<string, number> = {};
  for (const a of attendance) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  const lastPunch = attendance.filter((a) => a.actualIn).sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.date ?? null;

  const since90 = addDays(today, -90);
  const overtime = db.overtime.filter((o) => o.employeeId === e.id && o.status === "approved" && o.date >= since90);
  const deductions = db.deductions.filter((d) => d.employeeId === e.id && d.date >= since90);
  const leaves = db.leaves.filter((l) => l.employeeId === e.id).sort((a, b) => (a.from < b.from ? 1 : -1)).slice(0, 5);

  const lastPayroll = db.payrollRecords
    .filter((r) => r.employeeId === e.id)
    .map((r) => ({ r, p: db.payrollPeriods.find((p) => p.id === r.periodId) }))
    .sort((a, b) => ((a.p?.year ?? 0) * 12 + (a.p?.month ?? 0) < (b.p?.year ?? 0) * 12 + (b.p?.month ?? 0) ? 1 : -1))[0];

  return {
    identity: {
      employeeNumber: e.employeeNumber,
      name: e.name,
      department: deptName(ctx, e),
      jobTitle: e.jobTitle,
      status: e.status,
      hireDate: e.hireDate,
      tenureMonths: monthsBetween(e.hireDate, today),
      shift: shift ? `${shift.name} (${shift.startTime}-${shift.endTime})` : null,
    },
    personal: {
      nationalId: e.nationalId ?? null,
      phone: e.phone ?? null,
      address: e.address ?? null,
      qualification: e.qualification ?? null,
      militaryStatus: e.militaryStatus ?? null,
    },
    pay: {
      salaryType: e.salaryType,
      basicSalary: e.basicSalary,
      dailyRate: e.dailyRate ?? null,
      dailyWorkingHours: e.dailyWorkingHours,
      fixedMonthlyAllowances: e.allowances,
      lastPayroll: lastPayroll
        ? { period: lastPayroll.p?.label ?? null, gross: lastPayroll.r.grossSalary, deductions: lastPayroll.r.totalDeductions, net: lastPayroll.r.netSalary }
        : null,
    },
    documents: {
      requiredForThisEmployee: required.map((t) => docLabel(ctx, t)),
      missing: missing.map((t) => docLabel(ctx, t)),
      onFile: [...byType.entries()].map(([t, n]) => ({ type: docLabel(ctx, t), files: n })),
      totalFiles: docs.length,
    },
    missingDetails: missingProfileFields(ctx, e),
    attendanceLast30Days: {
      daysRecorded: attendance.length,
      byStatus,
      totalLateMinutes: attendance.reduce((s, a) => s + a.lateMinutes, 0),
      lastDayWithPunch: lastPunch,
    },
    recentLeaves: leaves.map((l) => ({ type: l.type, from: l.from, to: l.to, status: l.status })),
    overtimeLast90Days: { approvedHours: overtime.reduce((s, o) => s + o.hours, 0), approvedAmount: overtime.reduce((s, o) => s + o.amount, 0) },
    deductionsLast90Days: { count: deductions.length, total: deductions.reduce((s, d) => s + d.amount, 0) },
    linkedToFingerprintDevice: Boolean(e.biometricDeviceUserId),
  };
}

export type GapSort = "most_missing" | "fewest_missing" | "fewest_files" | "most_files";
const GAP_SORTS: GapSort[] = ["most_missing", "fewest_missing", "fewest_files", "most_files"];

export function findDataGaps(ctx: ToolContext, args: { department?: string; limit?: number; sort?: string }) {
  const dep = args.department ? norm(args.department) : "";
  const limit = Math.min(Math.max(Number(args.limit) || 25, 1), MAX_LIST);
  const sort: GapSort = GAP_SORTS.includes(args.sort as GapSort) ? (args.sort as GapSort) : "most_missing";
  const people = ctx.db.employees.filter((e) => e.status !== "terminated" && (!dep || contains(deptName(ctx, e), dep)));

  const rows = people.map((e) => {
    const { missing, required, docs } = documentsFor(ctx, e);
    const fields = missingProfileFields(ctx, e);
    return {
      ...codeIfNeeded(ctx, e),
      name: e.name,
      department: deptName(ctx, e),
      missingDocuments: missing.map((t) => docLabel(ctx, t)),
      documentsMissingCount: missing.length,
      documentsRequiredCount: required.length,
      documentFilesOnFile: docs.length,
      missingDetails: fields,
      itemsMissing: missing.length + fields.length,
    };
  });

  const withGaps = rows.filter((r) => r.itemsMissing > 0).sort((a, b) => b.itemsMissing - a.itemsMissing);
  // the default lists only people who still have something missing; the other orders look at everyone
  const ranked =
    sort === "most_missing"
      ? withGaps
      : [...rows].sort((a, b) => {
          if (sort === "fewest_missing") return a.itemsMissing - b.itemsMissing || b.documentFilesOnFile - a.documentFilesOnFile;
          if (sort === "fewest_files") return a.documentFilesOnFile - b.documentFilesOnFile || b.itemsMissing - a.itemsMissing;
          return b.documentFilesOnFile - a.documentFilesOnFile || a.itemsMissing - b.itemsMissing; // most_files
        });

  const docTally = new Map<string, number>();
  const fieldTally = new Map<string, number>();
  for (const r of rows) {
    for (const d of r.missingDocuments) docTally.set(d, (docTally.get(d) ?? 0) + 1);
    for (const f of r.missingDetails) fieldTally.set(f, (fieldTally.get(f) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, employees]) => ({ label, employees }));

  return {
    employeesChecked: rows.length,
    employeesWithMissingItems: withGaps.length,
    employeesComplete: rows.length - withGaps.length,
    mostMissingDocuments: top(docTally),
    mostMissingDetails: top(fieldTally),
    sortedBy: sort,
    showing: Math.min(ranked.length, limit),
    employees: ranked.slice(0, limit),
  };
}

export function companyOverview(ctx: ToolContext) {
  const { db, today } = ctx;
  const people = db.employees;
  const active = people.filter((e) => e.status !== "terminated");

  const byDeptMap = new Map<string, Employee[]>();
  for (const e of active) {
    const n = deptName(ctx, e);
    byDeptMap.set(n, [...(byDeptMap.get(n) ?? []), e]);
  }
  const byDepartment = [...byDeptMap.entries()]
    .map(([department, list]) => {
      const paid = list.filter((e) => !salaryMissing(e));
      const monthly = (e: Employee) => (e.salaryType === "daily" ? (e.dailyRate ?? 0) * 26 : e.basicSalary);
      return {
        department,
        employees: list.length,
        employeesWithSalaryEntered: paid.length,
        averageMonthlySalary: paid.length ? Math.round(paid.reduce((s, e) => s + monthly(e), 0) / paid.length) : null,
        totalMonthlySalary: Math.round(paid.reduce((s, e) => s + monthly(e), 0)),
      };
    })
    .sort((a, b) => b.employees - a.employees);

  const cutoff = addDays(today, -92);
  const newHires = active.filter((e) => e.hireDate >= cutoff);

  const gaps = findDataGaps(ctx, { limit: 1 });
  const complete = active.filter((e) => documentsFor(ctx, e).missing.length === 0).length;
  const totalMissingSlots = active.reduce((s, e) => s + documentsFor(ctx, e).missing.length, 0);

  const since30 = addDays(today, -30);
  const recent = db.dailyAttendance.filter((a) => a.date >= since30 && a.date <= today);
  const tally = (status: string) => {
    const m = new Map<string, number>();
    for (const a of recent) if (a.status === status) m.set(a.employeeId, (m.get(a.employeeId) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, days]) => {
        const e = people.find((p) => p.id === id);
        return { ...(e ? codeIfNeeded(ctx, e) : {}), name: e?.name ?? "?", days };
      });
  };

  return {
    headcount: {
      total: people.length,
      active: people.filter((e) => e.status === "active").length,
      onLeave: people.filter((e) => e.status === "on_leave").length,
      terminated: people.filter((e) => e.status === "terminated").length,
    },
    byDepartment,
    recentHires: {
      last3Months: newHires.length,
      list: newHires.slice(0, 10).map((e) => ({ ...codeIfNeeded(ctx, e), name: e.name, hireDate: e.hireDate })),
    },
    documents: {
      employeesWithCompleteFiles: complete,
      employeesWithIncompleteFiles: active.length - complete,
      completionPercent: active.length ? Math.round((complete / active.length) * 100) : 0,
      totalMissingDocuments: totalMissingSlots,
      mostMissing: gaps.mostMissingDocuments,
    },
    dataQuality: {
      employeesWithoutRealDepartment: active.filter((e) => deptName(ctx, e) === UNASSIGNED_DEPARTMENT).length,
      employeesWithoutSalary: active.filter(salaryMissing).length,
      employeesWithoutNationalId: active.filter((e) => !e.nationalId).length,
      employeesNotLinkedToFingerprintDevice: active.filter((e) => !e.biometricDeviceUserId).length,
    },
    attendanceLast30Days: {
      recordsAnalysed: recent.length,
      absences: recent.filter((a) => a.status === "absent").length,
      lateArrivals: recent.filter((a) => a.status === "late").length,
      mostAbsent: tally("absent"),
      mostLate: tally("late"),
    },
  };
}

/** Runs one tool call by name. Unknown names and bad arguments come back as an { error } the model can read. */
export function executeTool(name: string, args: unknown, ctx: ToolContext): unknown {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (name) {
    case "search_employees":
      return searchEmployees(ctx, { query: str(a.query), department: str(a.department), status: str(a.status), limit: Number(a.limit) || undefined });
    case "get_employee":
      return getEmployee(ctx, { query: str(a.query) });
    case "find_missing_items":
      return findDataGaps(ctx, { department: str(a.department), limit: Number(a.limit) || undefined, sort: str(a.sort) });
    case "company_overview":
      return companyOverview(ctx);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * Company-wide figures handed to the model with every question, so overview-type questions ("how are we
 * doing?") need no tool round-trip. Deliberately aggregates only: no names, no employee numbers, nothing about
 * an individual. Anything about a person reaches the model only when a question needs it, through a tool.
 */
export function buildSnapshot(ctx: ToolContext): string {
  const { headcount, byDepartment, recentHires, documents, dataQuality, attendanceLast30Days } = companyOverview(ctx);
  return JSON.stringify({
    asOf: ctx.today,
    headcount,
    byDepartment,
    hiredInLast3Months: recentHires.last3Months,
    documents,
    dataQuality,
    attendanceLast30Days: {
      recordsAnalysed: attendanceLast30Days.recordsAnalysed,
      absences: attendanceLast30Days.absences,
      lateArrivals: attendanceLast30Days.lateArrivals,
    },
  });
}
