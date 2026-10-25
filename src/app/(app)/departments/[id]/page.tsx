import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, CalendarClock, Clock3, Fingerprint, TimerReset, UserCheck, UserMinus, UserPlus, UserX, Users, Wallet, CalendarDays, Hourglass } from "lucide-react";
import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { viewerScope } from "@/lib/scope";
import { getT, format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { departmentReport, parseReportRange } from "@/lib/department-report";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { Button } from "@/components/ui/button";
import { AttendanceTrendChart } from "@/components/dashboard/charts";
import { ReportRangeNav } from "@/components/departments/report-range-nav";
import { DepartmentReportExportButton } from "@/components/departments/department-report-export-button";
import {
  CostSection,
  DeductionsSection,
  DocumentsSection,
  EmployeesSection,
  Figures,
  LeavesSection,
  OvertimeSection,
  PayrollSection,
  RequestsSection,
  Section,
  TopTable,
} from "@/components/departments/department-report-sections";

/**
 * تقرير القسم: everything the system records about one department, for a chosen period — read only. The same
 * read model as the Excel export (departmentReport), limited to the viewer's scope; a department outside the
 * account's departments, or one that was removed, is a 404. Each section shows only to who holds its permission.
 */
export default async function DepartmentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireAccess("/departments");
  const [{ id }, { range: rangeParam }, db, t, locale] = await Promise.all([params, searchParams, getDb(), getT(), getLocale()]);
  const range = parseReportRange(rangeParam);
  const report = await departmentReport(viewerScope(user, db.employees), user, id, range, locale, { db });
  if (!report) notFound();

  const r = t.departmentReport;
  const canOpenEmployees = hasPermission(user, "employees");
  const manager = report.department.manager;
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const k = report.kpis;
  const today = report.todayAttendance;
  const a = report.attendance;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="gap-1 px-2">
          <Link href="/departments">
            <BackIcon className="h-4 w-4" />
            {r.back}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={translateLabel(report.department.name, locale)}
        description={r.description}
        actions={<DepartmentReportExportButton departmentId={report.department.id} range={range} hasEmployees={report.employees.length > 0} />}
      />

      <div className="flex flex-col gap-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-4 w-4" />
            {r.code}: <span className="font-semibold text-foreground tabular-nums">{report.department.code}</span>
          </span>
          <span>
            {r.manager}:{" "}
            {manager ? (
              canOpenEmployees && manager.employeeNumber ? (
                <Link href={`/employees/${encodeURIComponent(manager.employeeNumber)}`} className="font-semibold text-foreground hover:underline">
                  {manager.name}
                </Link>
              ) : (
                <span className="font-semibold text-foreground">{manager.name}</span>
              )
            ) : (
              "—"
            )}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{r.movedNote}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={r.kpiActive} value={k.active} icon={Users} tone="primary" />
        <KpiCard label={r.kpiOnLeave} value={k.onLeave} icon={CalendarClock} />
        <KpiCard label={r.kpiTerminated} value={k.terminated} icon={UserMinus} tone="destructive" />
        <KpiCard label={r.kpiNewHires} value={k.newHires} icon={UserPlus} tone="success" />
        <KpiCard label={r.kpiMonthly} value={k.monthly} icon={Wallet} />
        <KpiCard label={r.kpiDaily} value={k.daily} icon={CalendarDays} />
        <KpiCard label={r.kpiOvertimeEligible} value={k.overtimeEligible} icon={TimerReset} tone="warning" />
        <KpiCard label={r.kpiDeviceLinked} value={k.deviceLinked} icon={Fingerprint} />
      </div>

      <Section title={r.todayTitle} description={report.today}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label={r.todayPresent} value={today.present} icon={UserCheck} tone="success" />
          <KpiCard label={r.todayLate} value={today.late} icon={Clock3} tone="warning" />
          <KpiCard label={r.todayAbsent} value={today.absent} icon={UserX} tone="destructive" />
          <KpiCard label={r.todayMissingPunch} value={today.missingPunch} icon={Fingerprint} tone="warning" />
          <KpiCard label={r.todayLeave} value={today.leave} icon={CalendarClock} tone="primary" />
          <KpiCard label={r.todayNotYet} value={today.notYet} icon={Hourglass} />
        </div>
      </Section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ReportRangeNav departmentId={report.department.id} range={range} />
        <p className="text-sm text-muted-foreground tabular-nums">{format(r.period, { from: report.from, to: report.to })}</p>
      </div>

      <Section title={r.attendanceTitle}>
        <div className="flex flex-col gap-4">
          <Figures
            items={[
              { label: r.workdays, value: a.workdays },
              { label: r.attendanceRate, value: `${a.rate}%` },
              { label: r.absentDays, value: a.absentDays },
              { label: r.lateMinutes, value: a.lateMinutes },
              { label: r.earlyLeaveMinutes, value: a.earlyLeaveMinutes },
              { label: r.missingPunches, value: a.missingPunches },
            ]}
          />
          <div>
            <p className="mb-2 text-sm font-semibold">{r.trendTitle}</p>
            {/* like the dashboard's trend: a day with nothing recorded is left out, not drawn as zero */}
            <AttendanceTrendChart
              data={a.daily
                .filter((d) => d.present + d.absent + d.missingPunch + d.leave > 0)
                .map((d) => ({ date: d.date, present: d.present, late: d.late, absent: d.absent }))}
            />
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={r.topLate}>
          <TopTable rows={a.topLate} value={(x) => x.lateMinutes} unit={r.lateMinutes} t={t} link={canOpenEmployees} />
        </Section>
        <Section title={r.topAbsent}>
          <TopTable rows={a.topAbsent} value={(x) => x.absentDays} unit={r.absentDays} t={t} link={canOpenEmployees} />
        </Section>
      </div>

      <LeavesSection report={report} t={t} />
      {report.overtime && <OvertimeSection overtime={report.overtime} t={t} locale={locale} />}
      {report.deductions && <DeductionsSection deductions={report.deductions} t={t} locale={locale} />}
      {(report.payroll || report.cost) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {report.payroll && <PayrollSection payroll={report.payroll} t={t} locale={locale} />}
          {report.cost && <CostSection cost={report.cost} t={t} locale={locale} />}
        </div>
      )}
      {report.requests && <RequestsSection requests={report.requests} t={t} />}
      {report.documents && <DocumentsSection documents={report.documents} t={t} />}
      <EmployeesSection report={report} t={t} link={canOpenEmployees} />
    </div>
  );
}
