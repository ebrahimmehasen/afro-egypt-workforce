import { prisma } from "@/lib/prisma";
import { canApprove } from "@/lib/permissions";
import { inScope, viewerScope, type Scope } from "@/lib/scope";
import { today, addDays } from "@/lib/today";
import { dayStr } from "@/lib/serialize";
import { REVIEW_WINDOW_DAYS } from "@/lib/missing-punch-review";
import type { User } from "@/lib/types";

// "Is he really absent, or is it a fingerprint problem?" A day the attendance engine already marked "absent" — which
// it only ever does when there is no approved leave, mission or excuse for that day; see computeDailyAttendance in
// attendance-engine.ts, which gives the day a different status ("leave" / "mission" / "excused_absence") the moment
// one exists. So filtering on status === "absent" already excludes every excused day, with no extra lookup needed.
// A list only, like the punch-review one it sits next to: it never charges, never ends anyone's service, and an
// AbsenceReview row only silences the one it's for — the day itself is untouched.

export interface AbsentDayRow {
  employeeId: string;
  date: string;
}
export interface AbsenceCheckEmployee {
  id: string;
  name: string;
}
export interface AbsenceCheckDay {
  employeeId: string;
  name: string;
  date: string;
}

/** Who sees the list: the admin, and HR holding the attendance right — the same right that reviews punches. */
export const canSeeAbsenceCheck = (user: User): boolean => canApprove(user, "attendance");

/** `${employeeId}|${date}`, the key an AbsenceReview row and an absent day are matched by. */
export const absenceReviewKey = (employeeId: string, date: string): string => `${employeeId}|${date}`;

/**
 * The absent days still open for review, newest first: in `scope`, with no AbsenceReview row yet. Pure — everything
 * comes in as an argument, so the filtering can be tested without a database.
 */
export function absenceCheckDays(input: {
  /** Already the "absent"-status rows for the window; nothing else is read as absence here. */
  rows: AbsentDayRow[];
  employees: AbsenceCheckEmployee[];
  scope: Scope;
  /** `${employeeId}|${date}` already marked reviewed. */
  reviewed: ReadonlySet<string>;
}): AbsenceCheckDay[] {
  const byId = new Map(input.employees.map((e) => [e.id, e]));
  return input.rows
    .filter((r) => byId.has(r.employeeId) && inScope(input.scope, r.employeeId) && !input.reviewed.has(absenceReviewKey(r.employeeId, r.date)))
    .map((r) => ({ employeeId: r.employeeId, name: byId.get(r.employeeId)!.name, date: r.date }))
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? 1 : -1));
}

/**
 * The absent days this user may see between two days (inclusive), read from live data. Deleted employees are left
 * out; an employee no longer "active" is NOT — a day like this is exactly how someone who quietly left the job
 * without resigning first gets noticed.
 */
export async function loadAbsenceCheckForRange(user: User, from: string, to: string): Promise<AbsenceCheckDay[]> {
  if (!canSeeAbsenceCheck(user)) return [];
  const range = { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) };

  const [employees, rows, reviewed] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, name: true, departmentId: true } }),
    prisma.dailyAttendance.findMany({ where: { status: "absent", date: range }, select: { employeeId: true, date: true } }),
    prisma.absenceReview.findMany({ where: { date: range }, select: { employeeId: true, date: true } }),
  ]);

  return absenceCheckDays({
    rows: rows.map((r) => ({ employeeId: r.employeeId, date: dayStr(r.date) })),
    employees,
    scope: viewerScope(user, employees),
    reviewed: new Set(reviewed.map((r) => absenceReviewKey(r.employeeId, dayStr(r.date)))),
  });
}

/** The absent days this user may see, over the same look-back the punch review uses (REVIEW_WINDOW_DAYS). */
export async function loadAbsenceCheckDays(user: User): Promise<AbsenceCheckDay[]> {
  const last = today();
  return loadAbsenceCheckForRange(user, addDays(last, -REVIEW_WINDOW_DAYS), last);
}
