import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, rowsInScope, viewerScope } from "@/lib/scope";
import { canApprove, hasPermission } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { annualLeaveBalance, type LeaveBalance } from "@/lib/leave-balance";
import { today } from "@/lib/today";
import { loadDayKindRule, trackedAbsentDays } from "@/lib/leave-days";
import { PageHeader } from "@/components/shared/page-header";
import { LeaveFormDialog } from "@/components/leaves/leave-form-dialog";
import { LeavesTable } from "@/components/leaves/leaves-table";
import { PermissionDayRules } from "@/components/leaves/leave-form-dialog";
import { loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { at, dayTimes } from "@/lib/pay-engine";
import { permissionKind, type PermissionKind } from "@/lib/mid-day-exits";

export default async function LeavesPage() {
  const db = await getDb();
  const user = await requireAccess("/leaves");
  const t = await getT();

  const scope = viewerScope(user, db.employees);
  const employees = employeesInScope(scope, db.employees);
  const leaves = rowsInScope(scope, db.leaves);

  // Each visible employee's annual-leave balance, worked out now from the hire date and their annual leaves.
  const day = today();
  const dayKindOf = await loadDayKindRule();
  const balances: Record<string, LeaveBalance> = {};
  for (const e of employees) {
    balances[e.id] = annualLeaveBalance({
      hireDate: e.hireDate,
      leaves: leaves.filter((l) => l.employeeId === e.id),
      absentDays: trackedAbsentDays(db.dailyAttendance.filter((a) => a.employeeId === e.id)),
      asOf: day,
      kindOf: dayKindOf,
    });
  }

  const sorted = [...leaves].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Each visible employee's times, so the form can say how a permission will be treated, and each timed
  // permission's kind (temporary / leaving early) for the table — by the same rule the pay engine applies.
  const ctx = await loadPayContext();
  const dayRules: Record<string, PermissionDayRules> = {};
  for (const e of employees) {
    const rules = rulesFor(ctx, e);
    dayRules[e.id] = { schedule: scheduleFor(ctx, e), rules: { thursdayRuleEnabled: rules.thursdayRuleEnabled, thursdayWorkEnd: rules.thursdayWorkEnd } };
  }
  const permissionKinds: Record<string, PermissionKind> = {};
  for (const l of leaves) {
    const e = db.employees.find((x) => x.id === l.employeeId);
    if (l.type !== "permission" || !l.startTime || !l.durationMinutes || !e) continue;
    const schedule = scheduleFor(ctx, e);
    permissionKinds[l.id] = permissionKind(at(l.from, l.startTime, schedule.start), l.durationMinutes, dayTimes(l.from, schedule, rulesFor(ctx, e)).end);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.leaves.title}
        description={t.leaves.description}
        actions={<LeaveFormDialog employees={employees} balances={balances} dayRules={dayRules} />}
      />
      <LeavesTable leaves={sorted} employees={db.employees} canApprove={canApprove(user, "leaves")} canDelete={user.role === "admin"} permissionKinds={permissionKinds} />
    </div>
  );
}
