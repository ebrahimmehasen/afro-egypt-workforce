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
 * Archived means either someone archived them by hand (`archivedAt`), or they are terminated and
 * at least a month (30 days) has passed since their service ended (`terminatedAt`). The second
 * half is worked out from the clock on every read, so nothing has to run to archive anyone, and
 * moving the status back off "terminated" (which clears `terminatedAt`) un-archives them.
 *
 * A terminated employee with no `terminatedAt` can't be dated, so they are not archived.
 */
export function isArchived(employee: ArchiveFields, now: Date = new Date()): boolean {
  if (employee.archivedAt) return true;
  if (employee.status !== "terminated" || !employee.terminatedAt) return false;
  const ended = new Date(employee.terminatedAt).getTime();
  if (Number.isNaN(ended)) return false;
  return now.getTime() - ended >= ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** True when the employee is archived only because someone did it by hand (not by the one-month rule). */
export function isManuallyArchived(employee: Pick<ArchiveFields, "archivedAt">): boolean {
  return Boolean(employee.archivedAt);
}
