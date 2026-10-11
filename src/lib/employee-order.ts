import type { Employee, EmployeeStatus } from "@/lib/types";

/** What the archive rule reads — an `Employee`, or a raw database row (whose dates are `Date`s). */
interface ArchiveFields {
  status: EmployeeStatus;
  terminatedAt?: string | Date | null;
  archivedAt?: string | Date | null;
}

/**
 * Comparator that sinks terminated employees to the bottom of a list and leaves everyone else
 * where the list's own ordering put them. Chain it ahead of the list's normal order:
 * `rows.sort((a, b) => terminatedLast(a.employee, b.employee) || byName(a, b))`.
 *
 * Only a terminated status moves a person — "on leave" stays in place — and an employee that
 * can't be resolved (undefined) counts as not terminated.
 */
export function terminatedLast(
  a: Pick<Employee, "status"> | undefined,
  b: Pick<Employee, "status"> | undefined,
): number {
  return Number(a?.status === "terminated") - Number(b?.status === "terminated");
}

/** How long a terminated employee stays in the main list before they count as archived. */
export const ARCHIVE_AFTER_DAYS = 30;

/**
 * Is this employee archived? The one place that rule lives — every screen asks here.
 *
 * Only a terminated employee can be archived, so an employee who is not terminated never is, whatever
 * `archivedAt` still says. A terminated employee is archived when someone archived them by hand (`archivedAt`)
 * or at least a month (30 days) has passed since their service ended (`terminatedAt`). The one-month half is
 * worked out from the clock on every read, so nothing has to run to archive anyone, and moving the status
 * back off "terminated" (which clears both dates) un-archives them.
 *
 * A terminated employee with no `terminatedAt` and no `archivedAt` can't be dated, so is not archived.
 */
export function isArchived(employee: ArchiveFields, now: Date = new Date()): boolean {
  if (employee.status !== "terminated") return false;
  if (employee.archivedAt) return true;
  if (!employee.terminatedAt) return false;
  const ended = new Date(employee.terminatedAt).getTime();
  if (Number.isNaN(ended)) return false;
  return now.getTime() - ended >= ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** True when the employee is archived because someone did it by hand (not by the one-month rule). */
export function isManuallyArchived(employee: ArchiveFields): boolean {
  return employee.status === "terminated" && Boolean(employee.archivedAt);
}

/** May this employee be archived by hand right now? Only a terminated employee who isn't archived already. */
export function canArchive(employee: ArchiveFields, now: Date = new Date()): boolean {
  return employee.status === "terminated" && !isArchived(employee, now);
}

/**
 * When an employee's status becomes "terminated" their fingerprint-device link is cleared — and ONLY the link
 * (the two columns below). Their attendance, punches, pay and files are never touched, so the archived
 * profile keeps its whole history. Returns the columns to write, or nothing when no change is due: the
 * employee wasn't linked, or this edit isn't the moment they became terminated.
 */
export function deviceLinkClearOnTermination(
  before: { status: EmployeeStatus; biometricDeviceUserId?: string | null },
  nextStatus: EmployeeStatus,
): { biometricDeviceUserId: null; biometricLinkedAt: null } | null {
  if (nextStatus !== "terminated" || before.status === "terminated") return null;
  if (!before.biometricDeviceUserId) return null;
  return { biometricDeviceUserId: null, biometricLinkedAt: null };
}
