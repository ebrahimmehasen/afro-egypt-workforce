import * as XLSX from "xlsx";
import { getDictionary } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { translateLabel } from "@/lib/i18n/data-labels";
import {
  allowanceTypeLabel,
  deductionTypeLabel,
  leaveTypeLabel,
  payrollPeriodStatusLabel,
  requestStatusLabel,
} from "@/lib/i18n/labels";
import { STATEMENT_KINDS, statementKindLabel } from "@/lib/overtime-statement";
import type { DepartmentReport } from "@/lib/department-report";
import type { AllowanceType, DeductionType, EmployeeStatus } from "@/lib/types";

type Cell = string | number;

const DEDUCTION_TYPES: DeductionType[] = ["late", "absence", "early_leave", "permission", "unauthorized_exit", "penalty", "advance", "admin_deduction", "other"];
const ALLOWANCE_TYPES: AllowanceType[] = ["transport", "meal", "fixed", "incentive", "bonus"];

/** A sheet from rows (header row first), with column widths from the content — as the other exports do. */
function sheetOf(rows: Cell[][]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const width = Math.max(0, ...rows.map((r) => r.length));
  sheet["!cols"] = Array.from({ length: width }, (_, i) => ({ wch: Math.max(...rows.map((r) => String(r[i] ?? "").length)) + 2 }));
  return sheet;
}

/** An employee's status in the interface language (the page's employee list uses it too). */
export function employeeStatusLabel(status: EmployeeStatus, t: Dictionary): string {
  if (status === "on_leave") return t.employees.statusOnLeave;
  if (status === "terminated") return t.employees.statusTerminated;
  return t.employees.statusActive;
}

/** `department-report-ACC-2026-09-26_2026-10-25.xlsx` */
export function departmentReportFileName(report: Pick<DepartmentReport, "department" | "from" | "to">): string {
  return `department-report-${report.department.code}-${report.from}_${report.to}.xlsx`;
}

/**
 * The department report as a workbook: one sheet per section, in the interface language, a section's sheet only
 * when the report carries it (the read model leaves out what the viewer has no permission for). Money, hours and
 * days are numbers; dates are yyyy-MM-dd. Pure — no request, no database — so it is tested on its own.
 */
export function buildDepartmentReportWorkbook(
  report: DepartmentReport,
  locale: "ar" | "en",
  meta: { exportedBy: string; exportedAt: string },
): XLSX.WorkBook {
  const t = getDictionary(locale);
  const r = t.departmentReport;
  const book = XLSX.utils.book_new();
  const add = (name: string, rows: Cell[][]) => XLSX.utils.book_append_sheet(book, sheetOf(rows), name);

  // 1. summary
  const k = report.kpis;
  const today = report.todayAttendance;
  add(r.sheetSummary, [
    [r.department, translateLabel(report.department.name, locale)],
    [r.code, report.department.code],
    [r.manager, report.department.manager?.name ?? "-"],
    [r.from, report.from],
    [r.to, report.to],
    [r.exportedAt, meta.exportedAt],
    [r.exportedBy, meta.exportedBy],
    [r.movedNote],
    [],
    [r.kpiActive, k.active],
    [r.kpiOnLeave, k.onLeave],
    [r.kpiTerminated, k.terminated],
    [r.kpiNewHires, k.newHires],
    [r.kpiMonthly, k.monthly],
    [r.kpiDaily, k.daily],
    [r.kpiOvertimeEligible, k.overtimeEligible],
    [r.kpiDeviceLinked, k.deviceLinked],
    [],
    [r.todayTitle, report.today],
    [r.todayPresent, today.present],
    [r.todayLate, today.late],
    [r.todayAbsent, today.absent],
    [r.todayMissingPunch, today.missingPunch],
    [r.todayLeave, today.leave],
    [r.todayNotYet, today.notYet],
    [],
    [r.workdays, report.attendance.workdays],
    [`${r.attendanceRate} %`, report.attendance.rate],
    [r.absentDays, report.attendance.absentDays],
    [r.lateMinutes, report.attendance.lateMinutes],
    [r.earlyLeaveMinutes, report.attendance.earlyLeaveMinutes],
    [r.missingPunches, report.attendance.missingPunches],
  ]);

  // 2. daily attendance: one row per working day
  add(r.sheetDaily, [
    [t.common.date, r.todayPresent, r.todayLate, r.todayAbsent, r.todayMissingPunch, r.todayLeave, `${r.attendanceRate} %`],
    ...report.attendance.daily.map((d) => [d.date, d.present, d.late, d.absent, d.missingPunch, d.leave, d.rate]),
  ]);

  // 3. per-employee attendance
  add(r.sheetEmployees, [
    [r.colNumber, r.colName, t.common.status, r.presentDays, r.absentDays, r.lateMinutes, r.earlyLeaveMinutes, r.missingPunches],
    ...report.employees.map((e) => [e.employeeNumber, e.name, employeeStatusLabel(e.status, t), e.presentDays, e.absentDays, e.lateMinutes, e.earlyLeaveMinutes, e.missingPunches]),
  ]);

  // 4. leaves, then each employee's annual-leave balance
  add(r.sheetLeaves, [
    [r.colNumber, r.colName, r.colType, r.from, r.to, r.colDays, t.common.status],
    ...report.leaves.rows.map((l) => [l.employeeNumber, l.name, leaveTypeLabel(l.type, t), l.from, l.to, l.days, requestStatusLabel(l.status, t)]),
    [],
    [r.balanceHeading],
    [r.colNumber, r.colName, r.colBalance, r.colAvailable],
    ...report.leaves.balances.map((b) => [b.employeeNumber, b.name, b.balanceDays, b.availableDays]),
    [t.common.total, "", report.leaves.balanceTotal, ""],
  ]);

  // 5. overtime
  if (report.overtime) {
    const o = report.overtime;
    add(r.sheetOvertime, [
      [r.colNumber, r.colName, r.approvedHours, r.approvedAmount, ...STATEMENT_KINDS.map((kind) => statementKindLabel(kind, t)), r.pendingHours, r.pendingAmount],
      ...o.lines.map((l) => [l.employeeNumber, l.name, l.hours, l.amount, ...STATEMENT_KINDS.map((kind) => l.byKind[kind]), l.pendingHours, l.pendingAmount]),
      [t.common.total, "", o.total.hours, o.total.amount, ...STATEMENT_KINDS.map((kind) => o.total.byKind[kind]), o.total.pendingHours, o.total.pendingAmount],
    ]);
  }

  // 6. deductions and allowances
  if (report.deductions) {
    const d = report.deductions;
    add(r.sheetDeductions, [
      [r.colNumber, r.colName, ...DEDUCTION_TYPES.map((type) => deductionTypeLabel(type, t)), r.deductionsTotal, ...ALLOWANCE_TYPES.map((type) => allowanceTypeLabel(type, t))],
      ...d.lines.map((l) => [l.employeeNumber, l.name, ...DEDUCTION_TYPES.map((type) => l.byType[type]), l.total, ...ALLOWANCE_TYPES.map((type) => l.allowances[type])]),
      [t.common.total, "", ...DEDUCTION_TYPES.map((type) => d.byType[type]), d.total, ...ALLOWANCE_TYPES.map((type) => d.allowancesByType[type])],
    ]);
  }

  // 7. payroll: the latest calculated / approved period
  if (report.payroll) {
    const p = report.payroll;
    add(r.sheetPayroll, [
      [r.colNumber, r.colName, r.colBasic, r.colAllowances, r.colOvertime, r.colGross, r.colDeductions, r.colNet],
      ...p.lines.map((l) => [l.employeeNumber, l.name, l.basicSalary, l.allowances, l.overtime, l.gross, l.deductions, l.net]),
      [t.common.total, "", p.total.basicSalary, p.total.allowances, p.total.overtime, p.total.gross, p.total.deductions, p.total.net],
      [],
      [r.periodStatus, p.period ? `${p.period.label} — ${payrollPeriodStatusLabel(p.period.status, t)}` : r.noPayroll],
    ]);
  }

  // 8. cost: the department's /workforce-cost row
  if (report.cost) {
    const c = report.cost;
    add(r.sheetCost, [
      [t.common.date, `${c.year}-${String(c.month).padStart(2, "0")}`],
      [r.costTotal, c.total],
      [r.colOvertime, c.overtime],
      [r.colDeductions, c.deductions],
    ]);
  }

  // 9. work requests, and missing papers
  if (report.requests) {
    add(r.sheetRequests, [
      [t.common.date, r.colType, r.colTime, r.colEmployees, t.common.status, r.colRequestedBy, r.colDecidedBy, r.colDetails],
      ...report.requests.map((q) => [
        q.date,
        q.type === "late_work" ? t.workRequests.typeLateWork : t.workRequests.typeOther,
        q.fromTime ? `${q.fromTime} → ${q.toTime ?? ""}` : "",
        q.employees.join("، "),
        requestStatusLabel(q.status, t),
        q.requestedBy,
        q.decidedBy ?? "",
        q.details,
      ]),
    ]);
  }
  if (report.documents) {
    add(r.sheetDocuments, [
      [r.colNumber, r.colName, r.missingDocuments, r.missingAcknowledgments],
      ...report.documents.map((d) => [d.employeeNumber, d.name, d.missingDocuments, d.missingAcknowledgments]),
    ]);
  }

  book.Workbook = { Views: [{ RTL: locale === "ar" }] };
  return book;
}
