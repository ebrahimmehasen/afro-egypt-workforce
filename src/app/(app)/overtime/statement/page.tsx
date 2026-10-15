import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { currentYearMonth } from "@/lib/today";
import { employeesInScope, viewerScope } from "@/lib/scope";
import { statementParams } from "@/lib/overtime-statement";
import { loadOvertimeStatement } from "@/lib/overtime-statement-data";
import { PageHeader } from "@/components/shared/page-header";
import { OvertimeStatementView } from "@/components/overtime/overtime-statement-view";

/**
 * كشف الإضافي: every employee's approved overtime for a period (by default the 21st of the month before to the
 * 20th — overtime is paid on the 20th). Same access as /overtime (the "overtime" permission) and the viewer's
 * own scope. Read only.
 */
export default async function OvertimeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const user = await requireAccess("/overtime/statement");
  const [t, locale, db] = await Promise.all([getT(), getLocale(), getDb()]);
  const params = statementParams(await searchParams, currentYearMonth());
  const statement = params.invalidRange ? null : await loadOvertimeStatement(user, params.from, params.to, locale);

  // the departments the viewer's employees belong to, for the filter
  const deptIds = new Set(employeesInScope(viewerScope(user, db.employees), db.employees).map((e) => e.departmentId));
  const departments = db.departments
    .filter((d) => deptIds.has(d.id))
    .map((d) => ({ value: d.id, label: translateLabel(d.name, locale) }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.overtime.statement.title} description={t.overtime.statement.description} />
      <OvertimeStatementView
        key={`${params.year}-${params.month}|${params.from}|${params.to}`}
        statement={statement}
        year={params.year}
        month={params.month}
        from={params.from}
        to={params.to}
        departments={departments}
      />
    </div>
  );
}
