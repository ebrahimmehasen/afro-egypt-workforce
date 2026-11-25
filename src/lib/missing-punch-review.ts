import { prisma } from "@/lib/prisma";
import { canApprove } from "@/lib/permissions";
import { inScope, viewerScope, type Scope } from "@/lib/scope";
import { today, addDays } from "@/lib/today";
import { dayStr } from "@/lib/serialize";
import { PayContext, PayEmployee, kindOf, loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { at, dayTimes } from "@/lib/pay-engine";
import { permissionKind } from "@/lib/mid-day-exits";
import { pendingReturn } from "@/lib/pending-return";
import { MidDayInputs, loadMidDayInputs, midDayForDay } from "@/lib/mid-day-view";
import { lockedDayCheck } from "@/lib/attendance-deductions";
import type { User } from "@/lib/types";

// The days a forgotten punch leaves for a person to look at. A list only: nothing here changes a charge, a deduction,
// an overtime row or a pay month, and nothing is stored — it is read off live data, like the rest of the bell.

/** How far back the list looks (an approved or closed pay month is left out anyway, see `isLocked`). */
export const REVIEW_WINDOW_DAYS = 35;

export type ReviewReason =
  /** A normal working day whose status is "missing punch": a single punch, no check-out. */
  | "missing_punch"
  /** An odd number of punches between the first check-in and the last check-out (analyzeMidDay's missingPunch). */
  | "odd_punches"
  /**
   * An approved temporary timed permission and no exit at all — no stretch out in the middle of the day and no reviewed
   * punch from HR. On a day HR corrected the engine ignores the device's middle punches, so only a reviewed stretch clears it.
   */
  | "permission_unused"
  /**
   * Left on an approved temporary timed permission and never came back: the exit is the day's last punch, so the day looks like
   * an ordinary finished day. The same predicate as the bell alert (pending-return.ts). Cleared by a return punch, an HR reviewed
   * one included.
   */
  | "permission_no_return";

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
  /**
   * HR corrected this day: their check-in and check-out stand and the engine ignores every middle punch — so a day with an
   * approved temporary permission still needs a reviewed stretch (see case c).
   */
  correctionReason?: string | null;
}

export type ReviewEmployee = PayEmployee & { name: string };

/**
 * The days to review, newest first. Pure: everything comes in as an argument.
 *  - only a finished day (the employee's own working day, from their pay type / schedule, is over at `now`);
 *  - only an employee in `scope`, and only a day whose pay month is not approved or closed (`isLocked`);
 *  - one entry per employee-day, with the first reason that applies: a, then b, then d, then c.
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

    const workday = kindOf(ctx, row.date) === "workday";

    // (a) the day itself says a punch is missing — on a normal working day only (not the weekly day off or a holiday)
    if (row.status === "missing_punch") {
      if (workday) found("missing_punch");
      continue;
    }
    if (!row.actualIn || !row.actualOut) continue;

    const inputs = inputsFor(row.employeeId, row.date);
    const corrected = Boolean(row.correctionReason);
    const analysis = midDayForDay(ctx, employee, { date: row.date, actualIn: row.actualIn, actualOut: row.actualOut, corrected }, inputs, now);

    // (b) an odd number of punches in the middle of the day: an exit without its return, or the other way round
    if (analysis?.missingPunch) {
      found("odd_punches");
      continue;
    }

    // (d) left on a temporary permission and never back (the exit is the day's last punch). Not on a day HR corrected: HR has
    // settled its in and out, and a reviewed stretch is read by (b) and (c).
    if (!corrected && inputs && workday && pendingReturn({ date: row.date, punches: inputs.punches, permissions: inputs.permissions, scheduleStart: schedule.start, dayEnd, now })) {
      found("permission_no_return");
      continue;
    }

    // (c) a temporary timed permission was approved, but there is no exit in the middle of the day at all (no stretch
    // out, and the check-out is not the one the permission covers). A punch HR entered after reviewing is read by the engine
    // as an ordinary exit, so it clears this like any other. A corrected
    // day reads no device middle punch, so it stays here until a reviewed stretch exists.
    if (!analysis && inputs && workday) {
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

/**
 * The days that need review between two days (inclusive), for the employees in `scope`, read from live data. The
 * bell list and the payroll approval guard both read this, so they can never disagree about what needs review.
 * `isLocked` leaves out days (the list passes the approved / closed pay months; the guard checks a whole period).
 */
export async function loadReviewDays(opts: {
  scope: Scope | ((employees: { id: string; departmentId: string }[]) => Scope);
  from: string;
  to: string;
  isLocked?: (day: string, ctx: PayContext) => boolean;
  now?: Date;
}): Promise<ReviewDay[]> {
  const [ctx, employees, days] = await Promise.all([
    loadPayContext(),
    prisma.employee.findMany({ where: { deletedAt: null, status: "active" } }),
    prisma.dailyAttendance.findMany({ where: { date: { gte: new Date(`${opts.from}T00:00:00.000Z`), lte: new Date(`${opts.to}T00:00:00.000Z`) } } }),
  ]);
  const scope = typeof opts.scope === "function" ? opts.scope(employees) : opts.scope;
  const isLocked = (day: string) => Boolean(opts.isLocked?.(day, ctx));
  const rows: ReviewRow[] = days
    .map((d) => ({ employeeId: d.employeeId, date: dayStr(d.date), status: d.status, actualIn: d.actualIn, actualOut: d.actualOut, correctionReason: d.correctionReason }))
    .filter((r) => inScope(scope, r.employeeId) && !isLocked(r.date));
  // the punches and permissions are read only for the days that need them (a check-in and a check-out)
  const needing = rows.filter((r) => r.status !== "missing_punch" && r.actualIn && r.actualOut);
  const inputsFor = await loadMidDayInputs(
    ctx,
    employees.filter((e) => needing.some((r) => r.employeeId === e.id)),
    [...new Set(needing.map((r) => r.date))],
  );
  return missingPunchReviewDays({ rows, employees, ctx, scope, isLocked, inputsFor, now: opts.now ?? new Date() });
}

/** The days in a range that need review and that this user may see (inside their departments), outside approved or closed pay months. */
export async function loadReviewForViewer(user: User, from: string, to: string, now: Date = new Date()): Promise<ReviewDay[]> {
  if (!canSeeMissingPunchReview(user)) return [];
  const periods = await prisma.payrollPeriod.findMany({ where: { status: { in: ["approved", "closed"] } }, select: { year: true, month: true } });
  return loadReviewDays({
    scope: (employees) => viewerScope(user, employees),
    from,
    to,
    isLocked: (day, ctx) => lockedDayCheck(periods, ctx)(day),
    now,
  });
}

/** The days waiting for review that this user may see, over the last REVIEW_WINDOW_DAYS days. */
export async function loadMissingPunchReview(user: User, now: Date = new Date()): Promise<ReviewDay[]> {
  const last = today();
  return loadReviewForViewer(user, addDays(last, -REVIEW_WINDOW_DAYS), last, now);
}
