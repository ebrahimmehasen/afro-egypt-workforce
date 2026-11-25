import { prisma } from "@/lib/prisma";
import { inScope, viewerScope, type Scope } from "@/lib/scope";
import { today } from "@/lib/today";
import { PayContext, PayEmployee, kindOf, loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { at, dayTimes } from "@/lib/pay-engine";
import { dedupePunches, permissionKind } from "@/lib/mid-day-exits";
import { MidDayInputs, loadMidDayInputs } from "@/lib/mid-day-view";
import { canSeeMissingPunchReview } from "@/lib/missing-punch-review";
import type { User } from "@/lib/types";

// A pending-return alert for TODAY: an approved temporary timed permission whose written end has passed, an exit punch on
// it and no return punch. Informational only — it blocks no approval, charges nothing, creates no punch, and reads no
// click time. It needs no DailyAttendance row: it works off the punches and the approved permission alone.

export interface OverdueReturn {
  employeeId: string;
  name: string;
  date: string;
  permissionId: string;
  /** The permission's written end, "HH:MM". */
  permissionEnd: string;
  /** The exit punch still waiting for its return. */
  exitAt: Date;
}

export type OverdueEmployee = PayEmployee & { name: string };

const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Who is shown this alert. THE single place for the audience rule: today it is exactly the people who see the
 * missing-punch review list. A department head (once an account can be mapped to one) is added here, not in the detector.
 */
export const canSeeOverdueReturn = (user: User) => canSeeMissingPunchReview(user);

/**
 * The people waiting for a return at `now`, on `date` (today). Pure. One item per employee: the temporary permission that
 * ended without a return after the employee's exit. Not a working day, a permission that runs to the end of the day, an
 * employee out of scope, a day whose last punch is not an exit, or a return after the exit: nothing.
 */
export function overdueReturns(input: {
  date: string;
  employees: OverdueEmployee[];
  ctx: PayContext;
  scope: Scope;
  inputsFor: (employeeId: string, date: string) => MidDayInputs | undefined;
  now: Date;
}): OverdueReturn[] {
  const { date, ctx, scope, inputsFor, now } = input;
  if (kindOf(ctx, date) !== "workday") return [];
  const out: OverdueReturn[] = [];
  for (const employee of input.employees) {
    if (!inScope(scope, employee.id)) continue;
    const inputs = inputsFor(employee.id, date);
    if (!inputs || inputs.permissions.length === 0) continue;
    const rules = rulesFor(ctx, employee);
    const schedule = scheduleFor(ctx, employee);
    const dayEnd = dayTimes(date, schedule, rules).end;

    // the first punch is the check-in, then they alternate: an even count means the last one is an exit. A hand-added pair
    // is not read (as everywhere in the engine); a punch HR entered after reviewing (source hr_review) is.
    const punches = dedupePunches(inputs.punches.filter((p) => p.source !== "manual_correction"));
    if (punches.length < 2 || punches.length % 2 !== 0) continue;
    const exitAt = punches[punches.length - 1].at;

    const waiting = inputs.permissions
      .map((p) => {
        const start = at(date, p.startTime, schedule.start);
        return { id: p.id, start, end: new Date(start.getTime() + p.durationMinutes * 60_000), kind: permissionKind(start, p.durationMinutes, dayEnd) };
      })
      .filter((p) => p.kind === "temporary" && exitAt < p.end && now > p.end)
      .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
    if (!waiting) continue;
    out.push({ employeeId: employee.id, name: employee.name, date, permissionId: waiting.id, permissionEnd: clock(waiting.end), exitAt });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The alerts this user may see, from live data (read only). */
export async function loadOverdueReturns(user: User, now: Date = new Date()): Promise<OverdueReturn[]> {
  if (!canSeeOverdueReturn(user)) return [];
  const date = today();
  const [ctx, employees] = await Promise.all([loadPayContext(), prisma.employee.findMany({ where: { deletedAt: null, status: "active" } })]);
  const scope = viewerScope(user, employees);
  const visible = employees.filter((e) => inScope(scope, e.id));
  const inputsFor = await loadMidDayInputs(ctx, visible, [date]);
  return overdueReturns({ date, employees: visible, ctx, scope, inputsFor, now });
}
