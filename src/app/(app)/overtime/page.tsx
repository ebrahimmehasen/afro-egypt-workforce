import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, rowsInScope, viewerScope } from "@/lib/scope";
import { hasPermission } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { OvertimeFormDialog } from "@/components/overtime/overtime-form-dialog";
import { OvertimeTable } from "@/components/overtime/overtime-table";
import { loadPayContext, rulesFor, scheduleFor } from "@/lib/pay-context";
import { buildEntryContext } from "@/lib/entry-context";
import { hourlyRate } from "@/lib/pay-engine";

export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const initialStatus = (await searchParams).status ?? "all";
  const db = await getDb();
  const user = await requireAccess("/overtime");
  const t = await getT();

  const scope = viewerScope(user, db.employees);
  const employees = employeesInScope(scope, db.employees);
  const records = rowsInScope(scope, db.overtime);

  const sorted = [...records].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // the default rate offered for a manual entry: the hourly wage × the overtime multiplier of the employee's
  // pay type, both from settings
  const ctx = await loadPayContext();
  // what the details popup shows for each row: department, pay type and that day's attendance
  const entryContext = buildEntryContext(sorted, db, ctx);
  const defaultRates = Object.fromEntries(
    employees.map((e) => {
      const rules = rulesFor(ctx, e);
      return [e.id, Math.round(hourlyRate(rules, scheduleFor(ctx, e), e) * rules.overtimeMultiplier)];
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.overtime.title}
        description={t.overtime.description}
        actions={<OvertimeFormDialog employees={employees} defaultRates={defaultRates} />}
      />
      <OvertimeTable
        key={initialStatus}
        records={sorted}
        employees={db.employees}
        canApprove={hasPermission(user, "overtime")}
        canManage={hasPermission(user, "overtime")}
        initialStatus={initialStatus}
        context={entryContext}
      />
    </div>
  );
}
