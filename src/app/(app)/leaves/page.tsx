import { getDb } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { scopeByEmployee, scopeEmployees } from "@/lib/scope";
import { canApprove } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { LeaveFormDialog } from "@/components/leaves/leave-form-dialog";
import { LeavesTable } from "@/components/leaves/leaves-table";

export default async function LeavesPage() {
  const db = await getDb();
  const user = await requireSession();
  const t = await getT();

  const employees = scopeEmployees(db.employees, user);
  const leaves = scopeByEmployee(db.leaves, user, db.employees);

  const sorted = [...leaves].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.leaves.title}
        description={t.leaves.description}
        actions={<LeaveFormDialog employees={employees} />}
      />
      <LeavesTable leaves={sorted} employees={db.employees} canApprove={canApprove(user.role)} />
    </div>
  );
}
