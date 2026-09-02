import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canApprove } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { OvertimeFormDialog } from "@/components/overtime/overtime-form-dialog";
import { OvertimeTable } from "@/components/overtime/overtime-table";

export default function OvertimePage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const initialStatus = searchParams.status ?? "all";
  const db = getDb();
  const user = getSession()!;
  const t = getT();

  let employees = db.employees;
  let records = db.overtime;
  if (user.role === "employee" && user.employeeId) {
    employees = employees.filter((e) => e.id === user.employeeId);
    records = records.filter((o) => o.employeeId === user.employeeId);
  } else if (user.role === "supervisor" && user.departmentId) {
    employees = employees.filter((e) => e.departmentId === user.departmentId);
    const ids = new Set(employees.map((e) => e.id));
    records = records.filter((o) => ids.has(o.employeeId));
  }

  const sorted = [...records].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.overtime.title}
        description={t.overtime.description}
        actions={<OvertimeFormDialog employees={employees} />}
      />
      <OvertimeTable
        key={initialStatus}
        records={sorted}
        employees={db.employees}
        canApprove={canApprove(user.role)}
        initialStatus={initialStatus}
      />
    </div>
  );
}
