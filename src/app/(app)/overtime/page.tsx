import { getDb } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { scopeByEmployee, scopeEmployees } from "@/lib/scope";
import { canApprove } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { OvertimeFormDialog } from "@/components/overtime/overtime-form-dialog";
import { OvertimeTable } from "@/components/overtime/overtime-table";

export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const initialStatus = (await searchParams).status ?? "all";
  const db = await getDb();
  const user = await requireSession();
  const t = await getT();

  const employees = scopeEmployees(db.employees, user);
  const records = scopeByEmployee(db.overtime, user, db.employees);

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
