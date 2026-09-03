import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { scopeByEmployee, scopeEmployees } from "@/lib/scope";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceReport } from "@/components/reports/attendance-report";
import { OvertimeReport } from "@/components/reports/overtime-report";
import { DeductionsReport } from "@/components/reports/deductions-report";
import { PayrollReport } from "@/components/reports/payroll-report";
import { currentYearMonth } from "@/lib/today";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; status?: string }>;
}) {
  const db = await getDb();
  const user = await requireAccess("/reports");
  const t = await getT();
  const locale = await getLocale();
  const ym = currentYearMonth();
  const period =
    db.payrollPeriods.find((p) => p.year === ym.year && p.month === ym.month) ?? db.payrollPeriods[0];

  const employees = scopeEmployees(db.employees, user);
  const dailyAttendance = scopeByEmployee(db.dailyAttendance, user, db.employees);
  const overtime = scopeByEmployee(db.overtime, user, db.employees);
  const deductions = scopeByEmployee(db.deductions, user, db.employees);
  const payrollRecords = scopeByEmployee(
    period ? db.payrollRecords.filter((r) => r.periodId === period.id) : [],
    user,
    db.employees,
  );

  const sp = await searchParams;
  const initialTab = sp.tab ?? "attendance";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.reports.title} description={t.reports.description} />

      <Tabs key={initialTab} defaultValue={initialTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="attendance">{t.reports.tabAttendance}</TabsTrigger>
          <TabsTrigger value="overtime">{t.reports.tabOvertime}</TabsTrigger>
          <TabsTrigger value="deductions">{t.reports.tabDeductions}</TabsTrigger>
          <TabsTrigger value="payroll">{t.reports.tabPayroll}</TabsTrigger>
        </TabsList>

        <TabsContent value="attendance">
          <AttendanceReport
            key={`${sp.from ?? ""}:${sp.to ?? ""}:${sp.status ?? ""}`}
            records={dailyAttendance}
            employees={employees}
            departments={db.departments}
            initialFrom={sp.from}
            initialTo={sp.to}
            initialStatus={sp.status}
          />
        </TabsContent>
        <TabsContent value="overtime">
          <OvertimeReport records={overtime} employees={employees} />
        </TabsContent>
        <TabsContent value="deductions">
          <DeductionsReport deductions={deductions} employees={employees} />
        </TabsContent>
        <TabsContent value="payroll">
          <PayrollReport records={payrollRecords} employees={employees} periodLabel={translateLabel(period?.label ?? "-", locale)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
