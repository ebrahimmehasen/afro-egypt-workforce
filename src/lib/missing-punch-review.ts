import { prisma } from "@/lib/prisma";
import { canApprove } from "@/lib/permissions";
import { inScope, viewerScope, type Scope } from "@/lib/scope";
import { today, addDays } from "@/lib/today";
import { dayStr } from "@/lib/serialize";
import { PayContext, PayEmployee, kindOf, loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { at, dayTimes } from "@/lib/pay-engine";
import { permissionKind } from "@/lib/mid-day-exits";
import { MidDayInputs, loadMidDayInputs, midDayForDay } from "@/lib/mid-day-view";
import { lockedDayCheck } from "@/lib/attendance-deductions";
import type { User } from "@/lib/types";

// The days a forgotten punch leaves for a person to look at. A list only: nothing here changes a charge, a deduction,
// an overtime row or a pay month, and nothing is stored — it is read off live data, like the rest of the bell.

/** How far back the list looks (an approved or closed pay month is left out anyway, see `isLocked`). */
export const REVIEW_WINDOW_DAYS = 35;

export type ReviewReason =
  /** The day's status is "missing punch": a single punch, or none of one kind. */
  | "missing_punch"
  /** An odd number of punches between the first check-in and the last check-out (analyzeMidDay's missingPunch). */
  | "odd_punches"
  /** An approved temporary timed permission, and not one punch in the middle of the day to show it was taken. */
  | "permission_unused";

export interface ReviewDay {
  employeeId: string;
  name: string;
  date: string;
  reason: ReviewReason;
}

export interface ReviewRow {
  employeeId: string;
  date: string;
  status: string;
  actualIn: Date | null;
  actualOut: Date | null;
  /** HR corrected this day: their check-in and check-out stand, so there is nothing left to review. */
  correctionReason?: string | null;
}

export type ReviewEmployee = PayEmployee & { name: string };

/**
 * The days to review, newest first. Pure: everything comes in as an argument.
 *  - only a finished day (the employee's own working day, from their pay type / schedule, is over at `now`);
 *  - only an employee in `scope`, and only a day whose pay month is not approved or closed (`isLocked`);
 *  - one entry per employee-day, with the first reason that applies: a, then b, then c.
 */
export function missingPunchReviewDays(input: {
  rows: ReviewRow[];
  employees: ReviewEmployee[];
  ctx: PayContext;
  scope: Scope;
  isLocked: (day: string) => boolean;
  inputsFor: (employeeId: string, date: string) => MidDayInputs | undefined;
  now: Date;
}): ReviewDay[] {
  const { ctx, scope, isLocked, inputsFor, now } = input;
  const byId = new Map(input.employees.map((e) => [e.id, e]));
  const out: ReviewDay[] = [];

  for (const row of input.rows) {
    const employee = byId.get(row.employeeId);
    if (!employee || !inScope(scope, row.employeeId) || isLocked(row.date)) continue;
    const rules = rulesFor(ctx, employee);
    const schedule = scheduleFor(ctx, employee);
    const dayEnd = dayTimes(row.date, schedule, rules).end;
    if (now < dayEnd) continue; // the day is not over yet

    const found = (reason: ReviewReason) => out.push({ employeeId: employee.id, name: employee.name, date: row.date, reason });

    // (a) the day itself says a punch is missing
    if (row.status === "missing_punch") {
      found("missing_punch");
      continue;
    }
    if (!row.actualIn || !row.actualOut || row.correctionReason) continue;

    const inputs = inputsFor(row.employeeId, row.date);
    const analysis = midDayForDay(ctx, employee, { date: row.date, actualIn: row.actualIn, actualOut: row.actualOut, corrected: false }, inputs, now);

    // (b) an odd number of punches in the middle of the day: an exit without its return, or the other way round
    if (analysis?.missingPunch) {
      found("odd_punches");
      continue;
    }

    // (c) a temporary timed permission was approved, but there is no exit punch in the middle of the day at all
    // (no stretch out, and the check-out is not the one the permission covers)
    if (!analysis && inputs && kindOf(ctx, row.date) === "workday") {
      const temporary = inputs.permissions.some(
        (p) => permissionKind(at(row.date, p.startTime, schedule.start), p.durationMinutes, dayEnd) === "temporary",
      );
      if (temporary) found("permission_unused");
    }
  }

  return out.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? 1 : -1));
}

/** Whether this user is shown the review list: who approves leaves or attendance (the admin, and HR with the right). */
export const canSeeMissingPunchReview = (user: User) => canApprove(user, "leaves") || canApprove(user, "attendance");

/** The days waiting for review that this user may see (inside their departments), read from live data. */
export async function loadMissingPunchReview(user: User, now: Date = new Date()): Promise<ReviewDay[]> {
  if (!canSeeMissingPunchReview(user)) return [];
  const last = today();
  const first = addDays(last, -REVIEW_WINDOW_DAYS);
  const [ctx, periods, employees, days] = await Promise.all([
    loadPayContext(),
    prisma.payrollPeriod.findMany({ where: { status: { in: ["approved", "closed"] } }, select: { year: true, month: true } }),
    prisma.employee.findMany({ where: { deletedAt: null, status: "active" } }),
    prisma.dailyAttendance.findMany({ where: { date: { gte: new Date(`${first}T00:00:00.000Z`), lte: new Date(`${last}T00:00:00.000Z`) } } }),
  ]);
  const scope = viewerScope(user, employees);
  const isLocked = lockedDayCheck(periods, ctx);
  const rows: ReviewRow[] = days
    .map((d) => ({ employeeId: d.employeeId, date: dayStr(d.date), status: d.status, actualIn: d.actualIn, actualOut: d.actualOut, correctionReason: d.correctionReason }))
    .filter((r) => inScope(scope, r.employeeId) && !isLocked(r.date));
  // the punches and permissions are read only for the days that need them (a check-in and a check-out, not corrected)
  const needing = rows.filter((r) => r.status !== "missing_punch" && r.actualIn && r.actualOut && !r.correctionReason);
  const inputsFor = await loadMidDayInputs(
    ctx,
    employees.filter((e) => needing.some((r) => r.employeeId === e.id)),
    [...new Set(needing.map((r) => r.date))],
  );
  return missingPunchReviewDays({ rows, employees, ctx, scope, isLocked, inputsFor, now });
}
