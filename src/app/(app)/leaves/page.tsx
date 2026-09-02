import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canApprove } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { LeaveFormDialog } from "@/components/leaves/leave-form-dialog";
import { LeavesTable } from "@/components/leaves/leaves-table";

export default async function LeavesPage() {
  const db = getDb();
  const user = (await getSession())!;
  const t = await getT();

  let employees = db.employees;
  let leaves = db.leaves;
  if (user.role === "employee" && user.employeeId) {
    employees = employees.filter((e) => e.id === user.employeeId);
    leaves = leaves.filter((l) => l.employeeId === user.employeeId);
  } else if (user.role === "supervisor" && user.departmentId) {
    employees = employees.filter((e) => e.departmentId === user.departmentId);
    const ids = new Set(employees.map((e) => e.id));
    leaves = leaves.filter((l) => ids.has(l.employeeId));
  }

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
