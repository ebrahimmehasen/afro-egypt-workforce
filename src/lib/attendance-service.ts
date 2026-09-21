import { ABSENCE_TRACKING_FROM, PUNCH_WINDOW_MS, absenceCandidates, computeDailyAttendance, getShiftWindow } from "@/lib/attendance-engine";
import { addDays, localDay } from "@/lib/today";
import { prisma } from "@/lib/prisma";
import { dayStr, toDailyAttendance } from "@/lib/serialize";
import { DailyAttendance } from "@/lib/types";
import { PayContext, effectiveShift, kindOf, loadPayContext } from "@/lib/pay-context";

/** yyyy-MM-dd for each calendar day in [from, to] inclusive. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/**
 * Recomputes and upserts the DailyAttendance row for every day in [from, to] for
 * one employee. Shared entry point for leave approval and any future backfill job.
 */
export async function recalculateRange(
  employeeId: string,
  from: string,
  to: string,
): Promise<void> {
  const ctx = await loadPayContext();
  for (const date of datesInRange(from, to)) {
    await recalculateDailyAttendance(employeeId, date, ctx);
  }
}

/**
 * Recomputes and upserts the DailyAttendance row for one employee/date from the
 * current raw logs + approved leave. The day's hours are the employee's own —
 * their custom times, fixed schedule, pay type or shift, with the pay type's grace
 * and Thursday rule (see pay-context.ts). Raw logs are gathered by that window
 * (which may cross midnight), not by calendar-day string match.
 */
export async function recalculateDailyAttendance(
  employeeId: string,
  date: string,
  ctx?: PayContext,
): Promise<DailyAttendance | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;
  const context = ctx ?? (await loadPayContext());
  const shift = effectiveShift(context, employee, date);

  const { scheduledStart, scheduledEnd } = getShiftWindow(date, shift);
  // widen the window a little so early / very-late punches are still attributed to this shift
  const windowStart = new Date(scheduledStart.getTime() - PUNCH_WINDOW_MS);
  const windowEnd = new Date(scheduledEnd.getTime() + PUNCH_WINDOW_MS);

  const rawLogs = await prisma.attendanceLog.findMany({
    where: { employeeId, timestamp: { gte: windowStart, lte: windowEnd } },
    orderBy: { timestamp: "asc" },
  });

  const dateOnly = new Date(`${date}T00:00:00.000Z`);
  const leave = await prisma.leave.findFirst({
    where: {
      employeeId,
      status: "approved",
      from: { lte: dateOnly },
      to: { gte: dateOnly },
    },
  });
  // A permission for the rest of the day is not a day off: the person works part of the day, and the time
  // they leave early is charged at the permission rate by the pay rules instead of as leaving without one.
  const fullDayLeave = leave && leave.type !== "permission" ? leave : null;

  const computed = computeDailyAttendance({
    employeeId,
    date,
    shift,
    logs: rawLogs.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      deviceId: l.deviceId ?? "",
      timestamp: l.timestamp.toISOString(),
      punchType: l.punchType,
      source: l.source,
    })),
    isOnApprovedLeave: Boolean(fullDayLeave),
    leaveType:
      fullDayLeave?.type === "mission"
        ? "mission"
        : fullDayLeave?.type === "excused_absence"
          ? "excused_absence"
          : "leave",
  });

  // Work on the weekly day off or a public holiday has no start to be late for and no end to leave before.
  if (kindOf(context, date) !== "workday" && (computed.status === "late" || computed.status === "early_leave")) {
    computed.status = "present";
    computed.lateMinutes = 0;
    computed.deductibleLateMinutes = 0;
    computed.earlyLeaveMinutes = 0;
  }

  const existing = await prisma.dailyAttendance.findUnique({
    where: { employeeId_date: { employeeId, date: dateOnly } },
  });

  const data = {
    shiftId: employee.shiftId,
    scheduledStart: computed.scheduledStart,
    scheduledEnd: computed.scheduledEnd,
    actualIn: computed.actualIn,
    actualOut: computed.actualOut,
    lateMinutes: computed.lateMinutes,
    deductibleLateMinutes: computed.deductibleLateMinutes,
    earlyLeaveMinutes: computed.earlyLeaveMinutes,
    workedMinutes: computed.workedMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status: computed.status,
  };

  const row = await prisma.dailyAttendance.upsert({
    where: { employeeId_date: { employeeId, date: dateOnly } },
    create: { employeeId, date: dateOnly, ...data },
    // a manual HR correction wins over an automatic recompute — keep its fields
    update: existing?.correctionReason ? {} : data,
  });

  return toDailyAttendance(row);
}

/**
 * Records the day for every linked employee who hasn't punched on a working day (see absenceCandidates):
 * absent, or leave if they have an approved one. Only writes days that have no record yet, so it is
 * cheap to run often and never touches a day that already exists. A punch that turns up later simply
 * recalculates that day into present or late.
 */
export async function recordAbsences(now: Date = new Date()): Promise<number> {
  const todayStr = localDay(now);
  const [employees, rows, ctx] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, status: "active", biometricDeviceUserId: { not: null } } }),
    prisma.dailyAttendance.findMany({
      where: { date: { gte: new Date(`${ABSENCE_TRACKING_FROM}T00:00:00.000Z`) } },
      select: { employeeId: true, date: true },
    }),
    loadPayContext(),
  ]);
  const byId = new Map(employees.map((e) => [e.id, e]));

  const candidates = absenceCandidates({
    employees: employees.map((e) => ({
      ...e,
      hireDate: dayStr(e.hireDate),
      linkedOn: e.biometricLinkedAt ? localDay(e.biometricLinkedAt) : null,
    })),
    shiftFor: (employeeId, day) => {
      const e = byId.get(employeeId);
      return e ? effectiveShift(ctx, e, day) : undefined;
    },
    weeklyOffDays: ctx.weeklyOffDays,
    recorded: new Set(rows.map((r) => `${r.employeeId}|${dayStr(r.date)}`)),
    today: todayStr,
    now,
    holidays: ctx.holidays,
  });
  for (const c of candidates) await recalculateDailyAttendance(c.employeeId, c.date, ctx);
  return candidates.length;
}

/**
 * Recalculates every day that can still change — from when absences are tracked, skipping days in pay months
 * already approved or closed — for all current employees. Run after pay settings change, so days not yet
 * locked follow the new rules while locked ones stay exactly as they were.
 */
export async function recalculateOpenDays(isLocked: (day: string) => boolean, now: Date = new Date()): Promise<number> {
  const ctx = await loadPayContext();
  const today = localDay(now);
  const rows = await prisma.dailyAttendance.findMany({
    where: { date: { gte: new Date(`${ABSENCE_TRACKING_FROM}T00:00:00.000Z`), lte: new Date(`${today}T00:00:00.000Z`) }, employee: { deletedAt: null } },
    select: { employeeId: true, date: true },
  });
  let count = 0;
  for (const r of rows) {
    const day = dayStr(r.date);
    if (isLocked(day)) continue;
    await recalculateDailyAttendance(r.employeeId, day, ctx);
    count++;
  }
  return count;
}
