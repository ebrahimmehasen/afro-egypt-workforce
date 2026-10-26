// The department report (/departments/[id] and its Excel export): one read model, so the page and the file
// always show the same numbers. Read only. Every figure comes from the rules the rest of the system already
// uses — attendance as recorded (absences are the "absent" rows the device sync writes through
// absenceCandidates), the leave-balance ledger, the overtime statement, /workforce-cost — nothing is
// recalculated here in a different way.

import { prisma } from "@/lib/prisma";
import { getDb } from "@/lib/data";
import { type Scope, scopedSnapshot } from "@/lib/scope";
import type { Store } from "@/lib/store";
import type { AllowanceType, AttendanceStatus, DeductionType, Employee, LeaveType, PayrollPeriodStatus, RequestStatus, User } from "@/lib/types";
import { hasPermission } from "@/lib/permissions";
import { ATTENDANCE_STATUS_GROUPS, attendanceSummary, isWorkday } from "@/lib/attendance-engine";
import { payPeriodOf, payPeriodRange } from "@/lib/pay-rules";
import { type PayContext, kindOf, loadPayContext, rulesFor } from "@/lib/pay-context";
import { annualLeaveBalance, requestDays } from "@/lib/leave-balance";
import { trackedAbsentDays } from "@/lib/leave-days";
import { STATEMENT_KINDS, type StatementKind, buildOvertimeStatement } from "@/lib/overtime-statement";
import { departmentWorkforceCost } from "@/lib/selectors";
import { missingDocumentTypes, requiredDocumentTypes } from "@/lib/documents";
import { missingAcknowledgmentKeys, requiredAcknowledgmentKeys } from "@/lib/acknowledgments";
import { isArchived, terminatedLast } from "@/lib/employee-order";
import { departmentCode } from "@/lib/department-codes";
import { addDays, localDay } from "@/lib/today";
import { type ReportRange, reportRangeDates } from "@/lib/department-report-range";

export { REPORT_RANGES, WEEK_DAYS, parseReportRange, reportRangeDates, type ReportRange } from "@/lib/department-report-range";
import { dayStr } from "@/lib/serialize";

/** Which sections the viewer may see: each follows the page permission it belongs to. */
export interface ReportSections {
  overtime: boolean;
  deductions: boolean;
  payroll: boolean;
  cost: boolean;
  requests: boolean;
  documents: boolean;
}

export function reportSections(user: Pick<User, "role" | "permissions">): ReportSections {
  return {
    overtime: hasPermission(user, "overtime"),
    deductions: hasPermission(user, "deductions"),
    payroll: hasPermission(user, "payroll"),
    cost: hasPermission(user, "workforce_cost"),
    requests: hasPermission(user, "requests"),
    documents: hasPermission(user, "employees"),
  };
}

export interface EmployeePeriodStats {
  employeeId: string;
  employeeNumber: string;
  name: string;
  status: Employee["status"];
  payType: string;
  todayStatus: AttendanceStatus | null;
  presentDays: number;
  absentDays: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  missingPunches: number;
  leaveDays: number;
}

export interface DailyRow {
  date: string;
  present: number;
  late: number;
  absent: number;
  missingPunch: number;
  leave: number;
  /** Of the people expected at work that day (recorded and not on leave / mission / excuse), the share who came. */
  rate: number;
}

export interface WorkRequestLine {
  id: string;
  date: string;
  type: "late_work" | "other";
  fromTime: string | null;
  toTime: string | null;
  details: string;
  /** Names of this department's workers on the request (within the viewer's scope). */
  employees: string[];
  status: RequestStatus;
  requestedBy: string;
  decidedBy: string | null;
}

export interface WorkRequestSource {
  id: string;
  date: string;
  type: "late_work" | "other";
  fromTime: string | null;
  toTime: string | null;
  details: string;
  employeeIds: string[];
  status: RequestStatus;
  requestedBy: string;
  decidedBy: string | null;
}

export interface DepartmentReport {
  department: { id: string; name: string; code: string; manager: { name: string; employeeNumber: string | null } | null };
  range: ReportRange;
  from: string;
  to: string;
  today: string;
  sections: ReportSections;
  kpis: {
    active: number;
    onLeave: number;
    terminated: number;
    newHires: number;
    monthly: number;
    daily: number;
    overtimeEligible: number;
    deviceLinked: number;
  };
  todayAttendance: { present: number; late: number; absent: number; missingPunch: number; leave: number; notYet: number };
  attendance: {
    workdays: number;
    rate: number;
    absentDays: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    missingPunches: number;
    daily: DailyRow[];
    topLate: EmployeePeriodStats[];
    topAbsent: EmployeePeriodStats[];
  };
  leaves: {
    daysByType: Record<LeaveType, number>;
    pending: number;
    rows: { employeeNumber: string; name: string; type: LeaveType; from: string; to: string; days: number; status: RequestStatus }[];
    topTakers: { employeeNumber: string; name: string; days: number }[];
    balances: { employeeNumber: string; name: string; balanceDays: number; availableDays: number }[];
    balanceTotal: number;
    balanceAverage: number;
  };
  overtime?: {
    lines: { employeeId: string; employeeNumber: string; name: string; hours: number; amount: number; byKind: Record<StatementKind, number>; pendingHours: number; pendingAmount: number }[];
    total: { hours: number; amount: number; byKind: Record<StatementKind, number>; pendingHours: number; pendingAmount: number };
    pendingCount: number;
  };
  deductions?: {
    byType: Record<DeductionType, number>;
    total: number;
    allowancesByType: Record<AllowanceType, number>;
    allowancesTotal: number;
    lines: { employeeNumber: string; name: string; byType: Record<DeductionType, number>; total: number; allowances: Record<AllowanceType, number> }[];
  };
  payroll?: {
    period: { id: string; label: string; year: number; month: number; status: PayrollPeriodStatus } | null;
    lines: { employeeNumber: string; name: string; basicSalary: number; allowances: number; overtime: number; gross: number; deductions: number; net: number }[];
    total: { basicSalary: number; allowances: number; overtime: number; gross: number; deductions: number; net: number };
  };
  cost?: { year: number; month: number; total: number; overtime: number; deductions: number };
  requests?: WorkRequestLine[];
  documents?: { employeeNumber: string; name: string; missingDocuments: number; missingAcknowledgments: number }[];
  employees: EmployeePeriodStats[];
}

/** How many people the top-late / top-absent / top-leave tables list. */
export const TOP_LIMIT = 10;

const DEDUCTION_TYPES: DeductionType[] = ["late", "permission_overrun", "absence", "early_leave", "permission", "unauthorized_exit", "penalty", "advance", "admin_deduction", "other"];
const ALLOWANCE_TYPES: AllowanceType[] = ["transport", "meal", "fixed", "incentive", "bonus"];
const LEAVE_TYPES: LeaveType[] = ["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"];
const zeros = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const round2 = (n: number) => Math.round(n * 100) / 100;
const PRESENT = ATTENDANCE_STATUS_GROUPS.present!;
const LEAVE = ATTENDANCE_STATUS_GROUPS.leave!;
/** Payroll periods whose records are final enough to report: calculated, approved, or approved and closed. */
const REPORTED_PERIOD_STATUSES: PayrollPeriodStatus[] = ["calculated", "approved", "closed"];

/** May this viewer open this department's report? A department-limited account only its own departments. */
export function canViewDepartment(scope: Scope, user: Pick<User, "departmentIds">, departmentId: string): boolean {
  return scope.all || (user.departmentIds ?? []).includes(departmentId);
}

/**
 * The report, from a snapshot already narrowed to the viewer's scope. Pure: everything it reads is passed in.
 * Returns null when the department doesn't exist (or was removed) — the caller answers 404.
 */
export function buildDepartmentReport(input: {
  db: Store;
  ctx: Pick<PayContext, "payTypes" | "weeklyOffDays" | "holidays" | "payPeriodStartDay">;
  departmentId: string;
  range: ReportRange;
  today: string;
  now: Date;
  sections: ReportSections;
  workRequests: WorkRequestSource[];
  locale: "ar" | "en";
}): DepartmentReport | null {
  const { db, ctx, range, today, sections } = input;
  const dept = db.departments.find((d) => d.id === input.departmentId);
  if (!dept) return null;

  const { from, to } = reportRangeDates(range, today, ctx.payPeriodStartDay);
  // attendance can't be ahead of today: the rest of a running pay month has nothing to count yet
  const lastDay = to < today ? to : today;
  const inRange = (day: string) => day >= from && day <= lastDay;
  const kindOfDay = (day: string) => kindOf(ctx, day);

  // Everyone on file in this department within the viewer's scope; history (attendance, pay) counts all of
  // them, while the lists leave out who is archived.
  const all = db.employees.filter((e) => e.departmentId === dept.id);
  const ids = new Set(all.map((e) => e.id));
  const listed = all.filter((e) => !isArchived(e, input.now));
  const working = all.filter((e) => e.status === "active" || e.status === "on_leave");
  const byId = new Map(all.map((e) => [e.id, e]));

  const manager = dept.managerId ? db.employees.find((e) => e.id === dept.managerId) : undefined;

  // --- header KPIs ---
  const currentPay = payPeriodOf(today, ctx.payPeriodStartDay);
  const currentPayRange = payPeriodRange(currentPay.year, currentPay.month, ctx.payPeriodStartDay);
  const kpis = {
    active: all.filter((e) => e.status === "active").length,
    onLeave: all.filter((e) => e.status === "on_leave").length,
    terminated: all.filter((e) => e.status === "terminated" && !isArchived(e, input.now)).length,
    newHires: listed.filter((e) => e.hireDate >= currentPayRange.from && e.hireDate <= currentPayRange.to).length,
    monthly: working.filter((e) => rulesFor(ctx, e).basis === "monthly").length,
    daily: working.filter((e) => rulesFor(ctx, e).basis === "daily").length,
    overtimeEligible: working.filter((e) => e.overtimeEligible !== false).length,
    deviceLinked: working.filter((e) => Boolean(e.biometricDeviceUserId)).length,
  };

  // --- today: the same people and the same counting as the attendance page ---
  const activeIds = new Set(all.filter((e) => e.status === "active").map((e) => e.id));
  const todayRecords = db.dailyAttendance.filter((a) => a.date === today && activeIds.has(a.employeeId));
  const summary = attendanceSummary(todayRecords);
  const todayAttendance = {
    present: summary.present + summary.late + summary.earlyLeave,
    late: summary.late,
    absent: summary.absent,
    missingPunch: summary.missingPunch,
    leave: summary.leave,
    notYet: activeIds.size - todayRecords.length,
  };
  const todayStatusOf = new Map(db.dailyAttendance.filter((a) => a.date === today && ids.has(a.employeeId)).map((a) => [a.employeeId, a.status]));

  // --- attendance over the range ---
  const records = db.dailyAttendance.filter((a) => ids.has(a.employeeId) && inRange(a.date));
  const daily: DailyRow[] = [];
  for (let day = from; day <= lastDay; day = addDays(day, 1)) {
    if (!isWorkday(day, ctx.holidays, ctx.weeklyOffDays)) continue;
    const dayRecords = records.filter((a) => a.date === day);
    const row = {
      date: day,
      present: dayRecords.filter((a) => PRESENT.includes(a.status)).length,
      late: dayRecords.filter((a) => a.status === "late").length,
      absent: dayRecords.filter((a) => a.status === "absent").length,
      missingPunch: dayRecords.filter((a) => a.status === "missing_punch").length,
      leave: dayRecords.filter((a) => LEAVE.includes(a.status)).length,
    };
    daily.push({ ...row, rate: attendanceRate(row) });
  }
  const totals = daily.reduce(
    (s, d) => ({ present: s.present + d.present, late: s.late + d.late, absent: s.absent + d.absent, missingPunch: s.missingPunch + d.missingPunch, leave: s.leave + d.leave }),
    { present: 0, late: 0, absent: 0, missingPunch: 0, leave: 0 },
  );

  const payTypeName = (e: Employee) => rulesFor(ctx, e).name;
  const statsOf = (e: Employee): EmployeePeriodStats => {
    const mine = records.filter((a) => a.employeeId === e.id);
    return {
      employeeId: e.id,
      employeeNumber: e.employeeNumber,
      name: e.name,
      status: e.status,
      payType: payTypeName(e),
      todayStatus: todayStatusOf.get(e.id) ?? null,
      presentDays: mine.filter((a) => PRESENT.includes(a.status)).length,
      absentDays: mine.filter((a) => a.status === "absent").length,
      // the minutes the dashboard and /workforce-cost count: lateness past the grace period
      lateMinutes: mine.reduce((s, a) => s + a.deductibleLateMinutes, 0),
      earlyLeaveMinutes: mine.reduce((s, a) => s + a.earlyLeaveMinutes, 0),
      missingPunches: mine.filter((a) => a.status === "missing_punch").length,
      leaveDays: mine.filter((a) => LEAVE.includes(a.status)).length,
    };
  };
  const stats = all.map(statsOf);
  const byName = (a: EmployeePeriodStats, b: EmployeePeriodStats) => a.name.localeCompare(b.name, input.locale);
  const topLate = stats.filter((s) => s.lateMinutes > 0).sort((a, b) => b.lateMinutes - a.lateMinutes || byName(a, b)).slice(0, TOP_LIMIT);
  const topAbsent = stats.filter((s) => s.absentDays > 0).sort((a, b) => b.absentDays - a.absentDays || byName(a, b)).slice(0, TOP_LIMIT);

  // --- leaves ---
  const deptLeaves = db.leaves.filter((l) => ids.has(l.employeeId) && l.from <= to && l.to >= from);
  const leaveRows = deptLeaves
    .map((l) => {
      const e = byId.get(l.employeeId)!;
      // the days of the leave inside the range, counted the way the balance counts them (working days, plus a
      // weekly day off between two of them; never a public holiday)
      const days = requestDays(l.from > from ? l.from : from, l.to < to ? l.to : to, kindOfDay);
      return { employeeNumber: e.employeeNumber, name: e.name, type: l.type, from: l.from, to: l.to, days, status: l.status };
    })
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const daysByType = zeros(LEAVE_TYPES);
  const taken = new Map<string, { employeeNumber: string; name: string; days: number }>();
  for (const r of leaveRows) {
    if (r.status !== "approved") continue;
    daysByType[r.type] += r.days;
    const cur = taken.get(r.employeeNumber) ?? { employeeNumber: r.employeeNumber, name: r.name, days: 0 };
    cur.days += r.days;
    taken.set(r.employeeNumber, cur);
  }
  // the annual-leave balance of everyone still working here, worked out now — as on the leaves page
  const balances = working.map((e) => {
    const b = annualLeaveBalance({
      hireDate: e.hireDate,
      leaves: db.leaves.filter((l) => l.employeeId === e.id),
      absentDays: trackedAbsentDays(db.dailyAttendance.filter((a) => a.employeeId === e.id)),
      asOf: today,
      kindOf: kindOfDay,
    });
    return { employeeNumber: e.employeeNumber, name: e.name, balanceDays: b.balanceDays, availableDays: b.availableDays };
  });
  const balanceTotal = round2(balances.reduce((s, b) => s + b.balanceDays, 0));

  const report: DepartmentReport = {
    department: {
      id: dept.id,
      name: dept.name,
      code: departmentCode(dept.name),
      manager: dept.managerName ? { name: dept.managerName, employeeNumber: manager?.employeeNumber ?? null } : null,
    },
    range,
    from,
    to,
    today,
    sections,
    kpis,
    todayAttendance,
    attendance: {
      workdays: daily.length,
      rate: attendanceRate(totals),
      absentDays: totals.absent,
      lateMinutes: stats.reduce((s, x) => s + x.lateMinutes, 0),
      earlyLeaveMinutes: stats.reduce((s, x) => s + x.earlyLeaveMinutes, 0),
      missingPunches: totals.missingPunch,
      daily,
      topLate,
      topAbsent,
    },
    leaves: {
      daysByType,
      pending: deptLeaves.filter((l) => l.status === "pending").length,
      rows: leaveRows,
      topTakers: [...taken.values()].sort((a, b) => b.days - a.days).slice(0, TOP_LIMIT),
      balances,
      balanceTotal,
      balanceAverage: balances.length ? round2(balanceTotal / balances.length) : 0,
    },
    employees: listed.map(statsOf).sort((a, b) => terminatedLast(byId.get(a.employeeId), byId.get(b.employeeId))),
  };

  if (sections.overtime) {
    // the overtime statement's own rule (approved only, by kind; removed entries never reach the snapshot)
    const rows = db.overtime.filter((o) => ids.has(o.employeeId) && o.date >= from && o.date <= to);
    const statement = buildOvertimeStatement({
      rows: rows.map((o) => ({ employeeId: o.employeeId, hours: o.hours, amount: o.amount, status: o.status, kind: o.kind ?? null, autoGenerated: Boolean(o.autoGenerated), voidedAt: null })),
      employees: all,
      departments: db.departments,
      locale: input.locale,
    });
    const pending = new Map<string, { hours: number; amount: number }>();
    for (const o of rows) {
      if (o.status !== "pending") continue;
      const cur = pending.get(o.employeeId) ?? { hours: 0, amount: 0 };
      pending.set(o.employeeId, { hours: round2(cur.hours + o.hours), amount: cur.amount + o.amount });
    }
    const lineIds = [...new Set([...statement.lines.map((l) => l.employeeId), ...pending.keys()])];
    const lines = lineIds
      .map((id) => {
        const e = byId.get(id)!;
        const l = statement.lines.find((x) => x.employeeId === id);
        const p = pending.get(id) ?? { hours: 0, amount: 0 };
        return { employeeId: id, employeeNumber: e.employeeNumber, name: e.name, hours: l?.hours ?? 0, amount: l?.amount ?? 0, byKind: l?.byKind ?? zeros(STATEMENT_KINDS), pendingHours: p.hours, pendingAmount: p.amount };
      })
      .sort((a, b) => terminatedLast(byId.get(a.employeeId), byId.get(b.employeeId)) || a.name.localeCompare(b.name, input.locale));
    report.overtime = {
      lines,
      total: {
        ...statement.total,
        pendingHours: round2(lines.reduce((s, l) => s + l.pendingHours, 0)),
        pendingAmount: lines.reduce((s, l) => s + l.pendingAmount, 0),
      },
      pendingCount: statement.pendingCount,
    };
  }

  if (sections.deductions) {
    // removed (voided) deductions never reach the snapshot
    const rows = db.deductions.filter((d) => ids.has(d.employeeId) && d.date >= from && d.date <= to);
    // the allowances in force for the pay month the range ends in: recurring ones, and a bonus of that month —
    // the same rule payroll applies
    const payMonth = payPeriodOf(to, ctx.payPeriodStartDay);
    const allowances = db.allowances.filter(
      (a) => ids.has(a.employeeId) && (a.monthly || (a.effectiveYear === payMonth.year && a.effectiveMonth === payMonth.month)),
    );
    const byType = zeros(DEDUCTION_TYPES);
    for (const d of rows) byType[d.type] += d.amount;
    const allowancesByType = zeros(ALLOWANCE_TYPES);
    for (const a of allowances) allowancesByType[a.type] += a.amount;
    const lineIds = [...new Set([...rows.map((d) => d.employeeId), ...allowances.map((a) => a.employeeId)])];
    report.deductions = {
      byType,
      total: rows.reduce((s, d) => s + d.amount, 0),
      allowancesByType,
      allowancesTotal: allowances.reduce((s, a) => s + a.amount, 0),
      lines: lineIds
        .map((id) => {
          const e = byId.get(id)!;
          const mine = zeros(DEDUCTION_TYPES);
          for (const d of rows) if (d.employeeId === id) mine[d.type] += d.amount;
          const allow = zeros(ALLOWANCE_TYPES);
          for (const a of allowances) if (a.employeeId === id) allow[a.type] += a.amount;
          return { employeeNumber: e.employeeNumber, name: e.name, byType: mine, total: Object.values(mine).reduce((s, n) => s + n, 0), allowances: allow };
        })
        .sort((a, b) => a.name.localeCompare(b.name, input.locale)),
    };
  }

  if (sections.payroll) {
    // the latest period that has records: calculated, approved or (approved and) closed
    const period = db.payrollPeriods
      .filter((p) => REPORTED_PERIOD_STATUSES.includes(p.status))
      .sort((a, b) => b.year - a.year || b.month - a.month)[0];
    const records = period ? db.payrollRecords.filter((r) => r.periodId === period.id && ids.has(r.employeeId)) : [];
    const lines = records
      .map((r) => {
        const e = byId.get(r.employeeId)!;
        return {
          employeeNumber: e.employeeNumber,
          name: e.name,
          basicSalary: r.basicSalary,
          allowances: r.allowances + r.incentives + r.bonuses,
          overtime: r.overtimeAmount,
          gross: r.grossSalary,
          deductions: r.totalDeductions,
          net: r.netSalary,
          terminated: e.status === "terminated",
        };
      })
      .sort((a, b) => Number(a.terminated) - Number(b.terminated) || a.name.localeCompare(b.name, input.locale))
      .map(({ terminated: _t, ...l }) => l);
    const sum = (k: keyof (typeof lines)[number]) => lines.reduce((s, l) => s + (l[k] as number), 0);
    report.payroll = {
      period: period ? { id: period.id, label: period.label, year: period.year, month: period.month, status: period.status } : null,
      lines,
      total: { basicSalary: sum("basicSalary"), allowances: sum("allowances"), overtime: sum("overtime"), gross: sum("gross"), deductions: sum("deductions"), net: sum("net") },
    };
  }

  if (sections.cost) {
    // exactly /workforce-cost's numbers: this calendar month's payroll records, net / overtime / deductions
    // the month /workforce-cost shows: this calendar month (currentYearMonth), read off `today`
    const ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
    report.cost = { ...ym, ...departmentWorkforceCost(db, ym.year, ym.month, dept.id) };
  }

  if (sections.requests) {
    report.requests = input.workRequests
      .filter((r) => r.date >= from && r.date <= to && r.employeeIds.some((id) => ids.has(id)))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((r) => ({
        id: r.id,
        date: r.date,
        type: r.type,
        fromTime: r.fromTime,
        toTime: r.toTime,
        details: r.details,
        employees: r.employeeIds.filter((id) => ids.has(id)).map((id) => byId.get(id)!.name),
        status: r.status,
        requestedBy: r.requestedBy,
        decidedBy: r.decidedBy,
      }));
  }

  if (sections.documents) {
    // the "incomplete papers" rule of the employees list
    report.documents = listed
      .map((e) => ({
        employeeNumber: e.employeeNumber,
        name: e.name,
        missingDocuments: missingDocumentTypes(db.employeeDocuments.filter((d) => d.employeeId === e.id), requiredDocumentTypes(e)).length,
        missingAcknowledgments: missingAcknowledgmentKeys(db.employeeAcknowledgments.filter((a) => a.employeeId === e.id), requiredAcknowledgmentKeys(e)).length,
      }))
      .filter((d) => d.missingDocuments > 0 || d.missingAcknowledgments > 0);
  }

  return report;
}

/** Of those expected at work (recorded, and not on leave / mission / excuse), the percentage who came — 0 with nobody expected. */
function attendanceRate(c: { present: number; absent: number; missingPunch: number }): number {
  const came = c.present + c.missingPunch;
  const expected = came + c.absent;
  return expected ? Math.round((came / expected) * 100) : 0;
}

/** Every work request, in the shape the report reads. A small table, read whole like /requests does. */
async function loadWorkRequests(): Promise<WorkRequestSource[]> {
  const rows = await prisma.workRequest.findMany({ orderBy: [{ date: "desc" }] });
  return rows.map((r) => ({
    id: r.id,
    date: dayStr(r.date),
    type: r.type,
    fromTime: r.fromTime,
    toTime: r.toTime,
    details: r.details,
    employeeIds: Array.isArray(r.employeeIds) ? (r.employeeIds as string[]) : [],
    status: r.status,
    requestedBy: r.requestedBy,
    decidedBy: r.decidedBy,
  }));
}

/**
 * The report for one department, as `user` may see it: null (→ 404) when the department doesn't exist, was
 * removed, or lies outside the account's departments. The page and the export both call this.
 */
export async function departmentReport(
  scope: Scope,
  user: Pick<User, "role" | "permissions" | "departmentIds">,
  departmentId: string,
  range: ReportRange,
  locale: "ar" | "en",
  opts: { db?: Store; now?: Date } = {},
): Promise<DepartmentReport | null> {
  if (!canViewDepartment(scope, user, departmentId)) return null;
  const sections = reportSections(user);
  const [db, ctx, workRequests] = await Promise.all([
    opts.db ? Promise.resolve(opts.db) : getDb(),
    loadPayContext(),
    sections.requests ? loadWorkRequests() : Promise.resolve([]),
  ]);
  const now = opts.now ?? new Date();
  return buildDepartmentReport({
    db: scopedSnapshot(scope, db),
    ctx,
    departmentId,
    range,
    today: localDay(now),
    now,
    sections,
    workRequests,
    locale,
  });
}
