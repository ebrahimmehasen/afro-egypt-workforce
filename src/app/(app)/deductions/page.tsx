import { getDb } from "@/lib/data";
import { loadMidDayInputs, midDayForDay } from "@/lib/mid-day-view";
import { requireAccess } from "@/lib/auth";
import { currentYearMonth } from "@/lib/today";
import { hasPermission } from "@/lib/permissions";
import { employeesInScope, rowsInScope, viewerScope } from "@/lib/scope";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeductionFormDialog } from "@/components/deductions/deduction-form-dialog";
import { AllowanceFormDialog } from "@/components/deductions/allowance-form-dialog";
import { DeductionsTable } from "@/components/deductions/deductions-table";
import { buildEntryContext } from "@/lib/entry-context";
import { loadPayContext } from "@/lib/pay-context";
import { AllowancesTable } from "@/components/deductions/allowances-table";

export default async function DeductionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const db = await getDb();
  const user = await requireAccess("/deductions");
  const t = await getT();
  const locale = await getLocale();
  const canManage = hasPermission(user, "deductions");

  const initialMonth = (await searchParams).month ?? null;
  const monthPeriod = initialMonth
    ? db.payrollPeriods.find((p) => `${p.year}-${String(p.month).padStart(2, "0")}` === initialMonth)
    : undefined;
  const monthLabel = monthPeriod ? translateLabel(monthPeriod.label, locale) : initialMonth;

  // only the viewer's own employees: a department supervisor sees — and files for — their department only
  const scope = viewerScope(user, db.employees);
  const employees = employeesInScope(scope, db.employees);
  const deductions = rowsInScope(scope, db.deductions).sort((a, b) => (a.date < b.date ? 1 : -1));
  // what the details popup shows for each row: department, pay type and that day's attendance
  // and, for a permission / leaving-without-permission / time-past-a-permission row, the day's exits and permissions
  const payContext = await loadPayContext();
  const midDayRows = deductions.filter((d) => d.type === "permission" || d.type === "unauthorized_exit" || d.type === "permission_overrun");
  const midDayEmployees = db.employees.filter((e) => midDayRows.some((d) => d.employeeId === e.id));
  const midDayInputs = await loadMidDayInputs(payContext, midDayEmployees, [...new Set(midDayRows.map((d) => d.date))]);
  const midDayRowKeys = new Set(midDayRows.map((d) => `${d.employeeId}|${d.date}`));
  const attendanceOf = new Map(db.dailyAttendance.map((a) => [`${a.employeeId}|${a.date}`, a]));
  const entryContext = buildEntryContext(deductions, db, payContext, (employeeId, date) => {
    const employee = midDayEmployees.find((e) => e.id === employeeId);
    const day = attendanceOf.get(`${employeeId}|${date}`);
    if (!employee || !day || !midDayRowKeys.has(`${employeeId}|${date}`)) return null;
    return midDayForDay(
      payContext,
      employee,
      { date, actualIn: day.actualIn ? new Date(day.actualIn) : null, actualOut: day.actualOut ? new Date(day.actualOut) : null, corrected: Boolean(day.correctionReason) },
      midDayInputs(employeeId, date),
    );
  });
  const allowances = rowsInScope(scope, db.allowances);

  // default the bonus month to the open (draft) period, else the real month
  const openPeriod = db.payrollPeriods.find((p) => p.status === "draft" || p.status === "calculated");
  const bonusPeriod = openPeriod
    ? { year: openPeriod.year, month: openPeriod.month }
    : currentYearMonth();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.deductions.title} description={t.deductions.description} />

      <Tabs defaultValue="deductions">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="deductions">{t.deductions.tabDeductions}</TabsTrigger>
            <TabsTrigger value="allowances">{t.deductions.tabAllowances}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="deductions" className="flex flex-col gap-4">
          {canManage && <div className="flex justify-end"><DeductionFormDialog employees={employees} /></div>}
          <DeductionsTable
            key={initialMonth ?? "all"}
            deductions={deductions}
            employees={employees}
            canManage={canManage}
            initialMonth={initialMonth}
            monthLabel={monthLabel}
            context={entryContext}
          />
        </TabsContent>

        <TabsContent value="allowances" className="flex flex-col gap-4">
          {canManage && (
            <div className="flex justify-end">
              <AllowanceFormDialog employees={employees} currentPeriod={bonusPeriod} />
            </div>
          )}
          <AllowancesTable allowances={allowances} employees={employees} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
