import type { Employee } from "@/lib/types";

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
