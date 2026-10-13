import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, rowsInScope, viewerScope } from "@/lib/scope";
import { hasPermission } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { annualLeaveBalance, type LeaveBalance } from "@/lib/leave-balance";
import { today } from "@/lib/today";
import { PageHeader } from "@/components/shared/page-header";
import { LeaveFormDialog } from "@/components/leaves/leave-form-dialog";
import { LeavesTable } from "@/components/leaves/leaves-table";

export default async function LeavesPage() {
  const db = await getDb();
  const user = await requireAccess("/leaves");
  const t = await getT();

  const scope = viewerScope(user, db.employees);
  const employees = employeesInScope(scope, db.employees);
  const leaves = rowsInScope(scope, db.leaves);

  // Each visible employee's annual-leave balance, worked out now from the hire date and their annual leaves.
  const day = today();
  const balances: Record<string, LeaveBalance> = {};
  for (const e of employees) {
    balances[e.id] = annualLeaveBalance(
      e.hireDate,
      leaves.filter((l) => l.employeeId === e.id),
      day,
    );
  }

  const sorted = [...leaves].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.leaves.title}
        description={t.leaves.description}
        actions={<LeaveFormDialog employees={employees} balances={balances} />}
      />
      <LeavesTable leaves={sorted} employees={db.employees} canApprove={hasPermission(user, "leaves")} canDelete={user.role === "admin"} />
    </div>
  );
}
