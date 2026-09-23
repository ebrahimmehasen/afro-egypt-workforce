import { EntryContext } from "@/components/shared/entry-details-dialog";
import { PayContext, rulesFor } from "@/lib/pay-context";
import { Store } from "@/lib/store";

/**
 * The extras the deductions / overtime lists show when a row is opened: the employee's department and pay
 * type, and the attendance of the very day the entry is about — the punches it was calculated from. Keyed by
 * the row's id, and only for the rows on screen.
 */
export function buildEntryContext(
  rows: { id: string; employeeId: string; date: string }[],
  db: Pick<Store, "employees" | "departments" | "dailyAttendance">,
  payContext: PayContext,
): Record<string, EntryContext> {
  const byEmployeeDay = new Map(db.dailyAttendance.map((a) => [`${a.employeeId}|${a.date}`, a]));
  const departments = new Map(db.departments.map((d) => [d.id, d.name]));
  const employees = new Map(db.employees.map((e) => [e.id, e]));

  const out: Record<string, EntryContext> = {};
  for (const row of rows) {
    const employee = employees.get(row.employeeId);
    const day = byEmployeeDay.get(`${row.employeeId}|${row.date}`);
    out[row.id] = {
      employee,
      department: employee ? departments.get(employee.departmentId) : undefined,
      payType: employee ? rulesFor(payContext, employee).name : undefined,
      day: day
        ? {
            actualIn: day.actualIn,
            actualOut: day.actualOut,
            status: day.status,
            lateMinutes: day.deductibleLateMinutes,
            workedMinutes: day.workedMinutes,
            scheduledStart: day.scheduledStart,
            scheduledEnd: day.scheduledEnd,
          }
        : undefined,
    };
  }
  return out;
}
