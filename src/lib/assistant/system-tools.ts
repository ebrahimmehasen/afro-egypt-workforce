import type { Employee } from "@/lib/types";
import {
  ToolContext,
  addDays,
  codeIfNeeded,
  contains,
  deptName,
  norm,
  resolveEmployee,
} from "@/lib/assistant/employee-tools";
import {
  attendanceStatusLabel,
  deductionTypeLabel,
  leaveTypeLabel,
  overtimeKindLabel,
  payrollPeriodStatusLabel,
  requestStatusLabel,
} from "@/lib/i18n/labels";

// Read-only tools for everything outside the employee files: attendance, leaves, overtime, deductions, payroll,
// departments and shifts. Like the employee tools they work on a Store already narrowed to what the asking user
// may see, return people by name (a number only to tell two same-named people apart) and never an internal id.

export const MAX_ROWS = 40;
export const TOP = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS: Record<"ar" | "en", string[]> = {
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

const dateProps = {
  date: { type: "string", description: "One day, yyyy-MM-dd. Use instead of from/to." },
  from: { type: "string", description: "First day of the period, yyyy-MM-dd." },
  to: { type: "string", description: "Last day of the period, yyyy-MM-dd (default today)." },
} as const;
const scopeProps = {
  department: { type: "string", description: "Limit to one department (partial name is fine)." },
  employee: { type: "string", description: "Limit to one employee: the name or the employee number." },
} as const;

export const SYSTEM_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "attendance_summary",
      description:
        "Attendance for a day or a period: how many present, late, absent, on leave…, total late minutes, who was absent or late, and — for one employee — their day-by-day record with in and out times. Defaults to today.",
      parameters: { type: "object", properties: { ...dateProps, ...scopeProps } },
    },
  },
  {
    type: "function",
    function: {
      name: "leaves_overview",
      description:
        "Leave requests overlapping a period (default: from 30 days ago to 60 days ahead): counts by status and type, and the list with who, type, dates, status and reason.",
      parameters: {
        type: "object",
        properties: { from: dateProps.from, to: dateProps.to, status: { type: "string", enum: ["pending", "approved", "rejected"] }, ...scopeProps },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "overtime_overview",
      description:
        "Overtime in a period (default last 30 days): total hours and amount by status, who has the most, and the requests still waiting for approval.",
      parameters: {
        type: "object",
        properties: { from: dateProps.from, to: dateProps.to, status: { type: "string", enum: ["pending", "approved", "rejected"] }, ...scopeProps },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deductions_overview",
      description:
        "Deductions and penalties in a period (default last 30 days): count and total, totals by type, who has the most, and the most recent entries with their reasons.",
      parameters: {
        type: "object",
        properties: {
          from: dateProps.from,
          to: dateProps.to,
          type: {
            type: "string",
            enum: ["late", "absence", "early_leave", "permission", "unauthorized_exit", "penalty", "advance", "admin_deduction", "other"],
          },
          ...scopeProps,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "payroll_overview",
      description:
        "Payroll for a month (default the latest one): the period status, total gross, deductions and net, totals by department, the highest net pay, and the list of all periods. Give an employee to get that person's full pay line for the month.",
      parameters: {
        type: "object",
        properties: {
          year: { type: "integer", description: "Calendar year, e.g. 2026." },
          month: { type: "integer", description: "Month 1-12." },
          ...scopeProps,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "departments_and_shifts",
      description: "The departments (head count, head of department) and the shifts (times, grace period, working days).",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export type SystemToolName = (typeof SYSTEM_TOOL_DEFINITIONS)[number]["function"]["name"];

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------

export const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v);
export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
export const round = (n: number) => Math.round(n * 100) / 100;
export const clip = (s: string | undefined, n = 200) => (s && s.length > n ? `${s.slice(0, n)}…` : (s ?? ""));

const cairoClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false });
export const clock = (iso: string | null | undefined) => (iso ? cairoClock.format(new Date(iso)) : null);

/** A validated period; one `date`, or from/to, falling back to the last `defaultDays` days (or a custom window). */
export function period(
  a: Record<string, unknown>,
  today: string,
  fallback: { from: string; to: string },
): { from: string; to: string } {
  if (isDay(a.date)) return { from: a.date, to: a.date };
  let to = isDay(a.to) ? a.to : fallback.to;
  let from = isDay(a.from) ? a.from : isDay(a.to) ? addDays(to, -29) : fallback.from;
  if (from > to) [from, to] = [to, from];
  if (addDays(from, 366) < to) from = addDays(to, -366);
  void today;
  return { from, to };
}

export const lastDays = (today: string, days: number) => ({ from: addDays(today, -(days - 1)), to: today });

export const person = (ctx: ToolContext, e: Employee) => ({ ...codeIfNeeded(ctx, e), name: e.name });

type Who = { error: unknown } | { ids: Set<string> | null; only?: Employee };

/** Which employees a question is about: everyone, one department, or one named person. */
function whoIs(ctx: ToolContext, a: Record<string, unknown>): Who {
  const department = str(a.department);
  const employee = str(a.employee);
  if (employee) {
    const { one, candidates } = resolveEmployee(ctx, employee);
    if (!one) {
      return {
        error: candidates?.length
          ? { found: false, ambiguous: true, message: "More than one employee matches — ask which one, or use the employee number.", candidates: candidates.slice(0, 10).map((e) => ({ employeeNumber: e.employeeNumber, name: e.name })) }
          : { found: false, message: "No employee matches that name or number in the records you can access." },
      };
    }
    return { ids: new Set([one.id]), only: one };
  }
  if (department) {
    const dep = norm(department);
    return { ids: new Set(ctx.db.employees.filter((e) => contains(deptName(ctx, e), dep)).map((e) => e.id)) };
  }
  return { ids: null };
}

const inWho = (who: { ids: Set<string> | null }, id: string) => who.ids === null || who.ids.has(id);

export function byId(ctx: ToolContext) {
  return new Map(ctx.db.employees.map((e) => [e.id, e]));
}

export function tally<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------------------------------

export function attendanceSummary(ctx: ToolContext, a: Record<string, unknown>) {
  const who = whoIs(ctx, a);
  if ("error" in who) return who.error;
  const { from, to } = period(a, ctx.today, { from: ctx.today, to: ctx.today });
  const people = byId(ctx);
  const rows = ctx.db.dailyAttendance.filter((r) => r.date >= from && r.date <= to && inWho(who, r.employeeId) && people.has(r.employeeId));
  const label = (s: string) => attendanceStatusLabel(s as never, ctx.t);

  const base = {
    period: { from, to },
    recordsAnalysed: rows.length,
    byStatus: tally(rows, (r) => label(r.status)),
    totalLateMinutes: rows.reduce((s, r) => s + r.lateMinutes, 0),
  };

  if (who.only) {
    return {
      ...base,
      employee: person(ctx, who.only),
      days: rows
        .sort((x, y) => (x.date < y.date ? 1 : -1))
        .slice(0, 40)
        .map((r) => ({ date: r.date, status: label(r.status), in: clock(r.actualIn), out: clock(r.actualOut), lateMinutes: r.lateMinutes })),
    };
  }

  const named = (r: (typeof rows)[number]) => {
    const e = people.get(r.employeeId)!;
    return { ...person(ctx, e), date: r.date, lateMinutes: r.lateMinutes };
  };
  const oneDay = from === to;
  const pick = (status: string) => rows.filter((r) => r.status === status);

  if (oneDay) {
    return {
      ...base,
      absent: pick("absent").slice(0, MAX_ROWS).map((r) => person(ctx, people.get(r.employeeId)!)),
      late: pick("late").sort((x, y) => y.lateMinutes - x.lateMinutes).slice(0, MAX_ROWS).map(named),
      missingPunch: pick("missing_punch").slice(0, MAX_ROWS).map((r) => person(ctx, people.get(r.employeeId)!)),
    };
  }

  const top = (status: string) => {
    const counts = new Map<string, number>();
    for (const r of pick(status)) counts.set(r.employeeId, (counts.get(r.employeeId) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, TOP).map(([id, days]) => ({ ...person(ctx, people.get(id)!), days }));
  };
  return { ...base, mostAbsent: top("absent"), mostLate: top("late") };
}

export function leavesOverview(ctx: ToolContext, a: Record<string, unknown>) {
  const who = whoIs(ctx, a);
  if ("error" in who) return who.error;
  const { from, to } = period(a, ctx.today, { from: addDays(ctx.today, -30), to: addDays(ctx.today, 60) });
  const status = str(a.status);
  const people = byId(ctx);
  const rows = ctx.db.leaves
    .filter((l) => l.from <= to && l.to >= from && inWho(who, l.employeeId) && people.has(l.employeeId) && (!status || l.status === status))
    .sort((x, y) => (x.from < y.from ? 1 : -1));
  const days = (l: (typeof rows)[number]) => Math.round((Date.parse(`${l.to}T00:00:00Z`) - Date.parse(`${l.from}T00:00:00Z`)) / 86_400_000) + 1;

  return {
    period: { from, to },
    total: rows.length,
    byStatus: tally(rows, (l) => requestStatusLabel(l.status, ctx.t)),
    byType: tally(rows, (l) => leaveTypeLabel(l.type, ctx.t)),
    showing: Math.min(rows.length, MAX_ROWS),
    leaves: rows.slice(0, MAX_ROWS).map((l) => ({
      ...person(ctx, people.get(l.employeeId)!),
      type: leaveTypeLabel(l.type, ctx.t),
      from: l.from,
      to: l.to,
      days: days(l),
      status: requestStatusLabel(l.status, ctx.t),
      reason: clip(l.reason),
    })),
  };
}

export function overtimeOverview(ctx: ToolContext, a: Record<string, unknown>) {
  const who = whoIs(ctx, a);
  if ("error" in who) return who.error;
  const { from, to } = period(a, ctx.today, lastDays(ctx.today, 30));
  const status = str(a.status);
  const people = byId(ctx);
  const rows = ctx.db.overtime.filter((o) => o.date >= from && o.date <= to && inWho(who, o.employeeId) && people.has(o.employeeId) && (!status || o.status === status));

  const byStatus: Record<string, { requests: number; hours: number; amount: number }> = {};
  for (const o of rows) {
    const k = requestStatusLabel(o.status, ctx.t);
    const cur = (byStatus[k] ??= { requests: 0, hours: 0, amount: 0 });
    cur.requests += 1;
    cur.hours = round(cur.hours + o.hours);
    cur.amount = round(cur.amount + o.amount);
  }
  const perPerson = new Map<string, { hours: number; amount: number }>();
  for (const o of rows.filter((x) => x.status !== "rejected")) {
    const cur = perPerson.get(o.employeeId) ?? { hours: 0, amount: 0 };
    perPerson.set(o.employeeId, { hours: round(cur.hours + o.hours), amount: round(cur.amount + o.amount) });
  }

  return {
    period: { from, to },
    requests: rows.length,
    byStatus,
    mostOvertime: [...perPerson.entries()]
      .sort((x, y) => y[1].hours - x[1].hours)
      .slice(0, TOP)
      .map(([id, v]) => ({ ...person(ctx, people.get(id)!), ...v })),
    waitingForApproval: rows
      .filter((o) => o.status === "pending")
      .slice(0, MAX_ROWS)
      .map((o) => ({ ...person(ctx, people.get(o.employeeId)!), date: o.date, hours: o.hours, amount: o.amount, kind: overtimeKindLabel(o.kind, ctx.t) })),
  };
}

export function deductionsOverview(ctx: ToolContext, a: Record<string, unknown>) {
  const who = whoIs(ctx, a);
  if ("error" in who) return who.error;
  const { from, to } = period(a, ctx.today, lastDays(ctx.today, 30));
  const type = str(a.type);
  const people = byId(ctx);
  const rows = ctx.db.deductions
    .filter((d) => d.date >= from && d.date <= to && inWho(who, d.employeeId) && people.has(d.employeeId) && (!type || d.type === type))
    .sort((x, y) => (x.date < y.date ? 1 : -1));

  const byType: Record<string, { count: number; amount: number }> = {};
  const perPerson = new Map<string, { count: number; amount: number }>();
  for (const d of rows) {
    const k = deductionTypeLabel(d.type, ctx.t);
    const cur = (byType[k] ??= { count: 0, amount: 0 });
    cur.count += 1;
    cur.amount = round(cur.amount + d.amount);
    const p = perPerson.get(d.employeeId) ?? { count: 0, amount: 0 };
    perPerson.set(d.employeeId, { count: p.count + 1, amount: round(p.amount + d.amount) });
  }

  return {
    period: { from, to },
    count: rows.length,
    totalAmount: round(rows.reduce((s, d) => s + d.amount, 0)),
    byType,
    mostDeducted: [...perPerson.entries()]
      .sort((x, y) => y[1].amount - x[1].amount)
      .slice(0, TOP)
      .map(([id, v]) => ({ ...person(ctx, people.get(id)!), ...v })),
    recent: rows.slice(0, 15).map((d) => ({
      ...person(ctx, people.get(d.employeeId)!),
      date: d.date,
      type: deductionTypeLabel(d.type, ctx.t),
      amount: d.amount,
      reason: clip(d.reason),
    })),
  };
}

export function payrollOverview(ctx: ToolContext, a: Record<string, unknown>) {
  const who = whoIs(ctx, a);
  if ("error" in who) return who.error;
  const { payrollPeriods: periods, payrollRecords: records } = ctx.db;
  const order = (p: { year: number; month: number }) => p.year * 12 + p.month;
  const sorted = [...periods].sort((x, y) => order(y) - order(x));
  if (!sorted.length) return { found: false, message: "No payroll period exists yet." };

  const year = Number(a.year) || undefined;
  const month = Number(a.month) || undefined;
  const chosen = year && month ? sorted.find((p) => p.year === year && p.month === month) : sorted[0];
  const allPeriods = sorted.slice(0, 24).map((p) => ({ label: p.label, status: payrollPeriodStatusLabel(p.status, ctx.t) }));
  if (!chosen) return { found: false, message: "There is no payroll for that month.", periods: allPeriods };

  const people = byId(ctx);
  const rows = records.filter((r) => r.periodId === chosen.id && inWho(who, r.employeeId) && people.has(r.employeeId));
  const sum = (pick: (r: (typeof rows)[number]) => number) => round(rows.reduce((s, r) => s + pick(r), 0));

  const header = { period: chosen.label, status: payrollPeriodStatusLabel(chosen.status, ctx.t), periods: allPeriods };

  if (who.only) {
    const r = rows[0];
    return r
      ? { ...header, employee: person(ctx, who.only), pay: { ...r, id: undefined, periodId: undefined, employeeId: undefined } }
      : { ...header, employee: person(ctx, who.only), message: "No pay line for this person in that month." };
  }

  const byDept = new Map<string, { employees: number; gross: number; deductions: number; net: number }>();
  for (const r of rows) {
    const k = deptName(ctx, people.get(r.employeeId)!);
    const cur = byDept.get(k) ?? { employees: 0, gross: 0, deductions: 0, net: 0 };
    byDept.set(k, {
      employees: cur.employees + 1,
      gross: round(cur.gross + r.grossSalary),
      deductions: round(cur.deductions + r.totalDeductions),
      net: round(cur.net + r.netSalary),
    });
  }

  return {
    ...header,
    employees: rows.length,
    totals: { gross: sum((r) => r.grossSalary), deductions: sum((r) => r.totalDeductions), net: sum((r) => r.netSalary), overtime: sum((r) => r.overtimeAmount ?? 0) },
    byDepartment: [...byDept.entries()].map(([department, v]) => ({ department, ...v })).sort((x, y) => y.net - x.net),
    highestNet: [...rows].sort((x, y) => y.netSalary - x.netSalary).slice(0, TOP).map((r) => ({ ...person(ctx, people.get(r.employeeId)!), net: r.netSalary })),
  };
}

export function departmentsAndShifts(ctx: ToolContext) {
  const days = WEEKDAYS[ctx.locale];
  const departments = ctx.db.departments.map((d) => {
    const members = ctx.db.employees.filter((e) => e.departmentId === d.id && e.status !== "terminated");
    return { name: d.name, employees: members.length, head: d.managerName ?? null };
  });
  return {
    departments: departments.sort((x, y) => y.employees - x.employees),
    shifts: ctx.db.shifts.map((s) => ({
      name: s.name,
      from: s.startTime,
      to: s.endTime,
      graceMinutes: s.gracePeriodMinutes,
      workDays: s.workDays.map((d) => days[d]).filter(Boolean),
      overtimeAllowed: s.allowOvertime,
    })),
  };
}

/** Runs one of these tools, or returns undefined when the name isn't one of them. */
export function executeSystemTool(name: string, args: unknown, ctx: ToolContext): unknown {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (name as SystemToolName) {
    case "attendance_summary":
      return attendanceSummary(ctx, a);
    case "leaves_overview":
      return leavesOverview(ctx, a);
    case "overtime_overview":
      return overtimeOverview(ctx, a);
    case "deductions_overview":
      return deductionsOverview(ctx, a);
    case "payroll_overview":
      return payrollOverview(ctx, a);
    case "departments_and_shifts":
      return departmentsAndShifts(ctx);
    default:
      return undefined;
  }
}
