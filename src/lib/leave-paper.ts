// The printable leave paper: what it shows beyond the leave row itself, and who may open it. Pure.
import type { Leave, User } from "@/lib/types";
import { ABSENCE_LEAVE_TYPES, requestDays, type DayKindOf } from "@/lib/leave-balance";
import { canAccess } from "@/lib/permissions";
import { inScope, type Scope } from "@/lib/scope";

const DAY_MS = 86_400_000;

/**
 * The days a leave covers. `calendar` is every day from the first to the last, inclusive. `charged` is only given for a
 * leave that is a day of absence (annual, casual, sick, unpaid, excused): the days the balance and the pay rules count
 * for it (requestDays: its working days, plus a weekly day off between two of them; never a holiday, and never a weekly
 * day off at either end of the range). A mission or a permission is not a day of absence, so it has no such count.
 */
export function leavePaperDays(leave: Pick<Leave, "type" | "from" | "to">, kindOf: DayKindOf): { calendar: number; charged: number | null } {
  const start = Date.parse(`${leave.from}T00:00:00Z`);
  const end = Date.parse(`${leave.to}T00:00:00Z`);
  const calendar = Number.isNaN(start) || Number.isNaN(end) || end < start ? 0 : Math.round((end - start) / DAY_MS) + 1;
  const charged = ABSENCE_LEAVE_TYPES.includes(leave.type) ? requestDays(leave.from, leave.to, kindOf) : null;
  return { calendar, charged };
}

/**
 * Whether `user` may open the paper of a leave of `employeeId`: exactly who can see that leave in the leaves list —
 * an account that can open the leaves page, and only for an employee in its scope (a self-service employee: their own).
 */
export function canViewLeavePaper(user: User, employeeId: string, scope: Scope): boolean {
  return canAccess(user, "/leaves") && inScope(scope, employeeId);
}

/** Only an approved request is a leave; a pending or rejected one is marked "not approved" on the paper. */
export const isApprovedLeave = (leave: Pick<Leave, "status">) => leave.status === "approved";
