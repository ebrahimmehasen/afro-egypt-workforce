import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceReport } from "@/components/reports/attendance-report";
import { OvertimeReport } from "@/components/reports/overtime-report";
import { DeductionsReport } from "@/components/reports/deductions-report";
import { PayrollReport } from "@/components/reports/payroll-report";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; status?: string }>;
}) {
  const db = getDb();
  const t = await getT();
  const locale = await getLocale();
  const period = db.payrollPeriods.find((p) => p.id === "PP-2026-08") ?? db.payrollPeriods[0];
  const payrollRecords = period ? db.payrollRecords.filter((r) => r.periodId === period.id) : [];
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
            records={db.dailyAttendance}
            employees={db.employees}
            departments={db.departments}
            initialFrom={sp.from}
            initialTo={sp.to}
            initialStatus={sp.status}
          />
        </TabsContent>
        <TabsContent value="overtime">
          <OvertimeReport records={db.overtime} employees={db.employees} />
        </TabsContent>
        <TabsContent value="deductions">
          <DeductionsReport deductions={db.deductions} employees={db.employees} />
        </TabsContent>
        <TabsContent value="payroll">
          <PayrollReport records={payrollRecords} employees={db.employees} periodLabel={translateLabel(period?.label ?? "-", locale)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
