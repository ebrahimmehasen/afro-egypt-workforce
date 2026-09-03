import Link from "next/link";
import {
  Users, UserCheck, UserX, Clock3, CalendarClock, Fingerprint,
  Wallet, TimerReset, MinusCircle, TrendingDown,
} from "lucide-react";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { formatEGP } from "@/lib/constants";
import { today as todayDate, currentYearMonth } from "@/lib/today";
import { getT, format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { monthName } from "@/lib/i18n/format";
import { translateLabel } from "@/lib/i18n/data-labels";
import { displayUserName } from "@/lib/i18n/labels";
import {
  getAttendanceByDepartment,
  getAttendanceTrend,
  getMonthlyKpis,
  getTodayKpis,
  getTopLateEmployees,
} from "@/lib/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AttendanceTrendChart, DepartmentAttendanceChart } from "@/components/dashboard/charts";
import { Badge } from "@/components/ui/badge";
import { AttendanceStatusBadge } from "@/components/shared/status-badge";

export default async function DashboardPage() {
  const user = await requireSession();
  const t = await getT();
  const locale = await getLocale();

  if (user.role === "employee" && user.employeeId) {
    return <EmployeeDashboard employeeId={user.employeeId} userName={displayUserName(user, t)} />;
  }

  const todayIso = todayDate();
  const ym = currentYearMonth();
  const monthPrefix = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const today = await getTodayKpis(todayIso);
  const monthly = await getMonthlyKpis(ym.year, ym.month);
  const trend = await getAttendanceTrend(14, todayIso);
  const byDept = (await getAttendanceByDepartment()).map((d) => ({ ...d, department: translateLabel(d.department, locale) }));
  const topLate = await getTopLateEmployees(5);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${t.dashboard.welcome} ${displayUserName(user, t)}`}
        description={t.dashboard.overview}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label={t.dashboard.totalEmployees} value={today.totalEmployees} icon={Users} tone="default" href="/employees" />
        <KpiCard
          label={t.dashboard.presentToday}
          value={today.presentToday}
          icon={UserCheck}
          tone="success"
          href={`/attendance?date=${todayIso}&status=present`}
        />
        <KpiCard
          label={t.dashboard.absentToday}
          value={today.absentToday}
          icon={UserX}
          tone="destructive"
          href={`/attendance?date=${todayIso}&status=absent`}
        />
        <KpiCard
          label={t.dashboard.lateToday}
          value={today.lateToday}
          icon={Clock3}
          tone="warning"
          href={`/attendance?date=${todayIso}&status=late`}
        />
        <KpiCard
          label={t.dashboard.onLeaveToday}
          value={today.onLeaveToday}
          icon={CalendarClock}
          tone="primary"
          href={`/attendance?date=${todayIso}&status=leave`}
        />
        <KpiCard
          label={t.dashboard.missingPunchToday}
          value={today.missingPunchToday}
          icon={Fingerprint}
          tone="warning"
          href={`/attendance?date=${todayIso}&status=missing_punch`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={format(t.dashboard.totalPayrollMonth, { month: monthName(ym.month, locale) })}
          value={formatEGP(monthly.totalPayroll, locale)}
          icon={Wallet}
          tone="primary"
          hint={monthly.payrollCalculated ? undefined : t.dashboard.payrollNotCalculated}
          href="/payroll"
        />
        <KpiCard
          label={t.dashboard.approvedOvertime}
          value={formatEGP(monthly.overtimeTotal, locale)}
          icon={TimerReset}
          tone="success"
          href="/overtime?status=approved"
        />
        <KpiCard
          label={t.dashboard.deductions}
          value={formatEGP(monthly.deductionsTotal, locale)}
          icon={MinusCircle}
          tone="destructive"
          href={`/deductions?month=${monthPrefix}`}
        />
        <KpiCard
          label={t.dashboard.absenceLateCost}
          value={formatEGP(monthly.absenceCost + monthly.lateCost, locale)}
          icon={TrendingDown}
          tone="warning"
          href={`/reports?tab=attendance&from=${monthPrefix}-01&to=${monthPrefix}-28&status=absent_late`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.attendanceTrend}</CardTitle>
            <CardDescription>{t.dashboard.attendanceTrendDesc} {todayIso}</CardDescription>
          </CardHeader>
          <CardContent>
            <AttendanceTrendChart data={trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.attendanceByDept}</CardTitle>
            <CardDescription>{t.dashboard.attendanceByDeptDesc} {todayIso}</CardDescription>
          </CardHeader>
          <CardContent>
            <DepartmentAttendanceChart data={byDept} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.dashboard.topLateEmployees}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {topLate.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.dashboard.noLateDataYet}</p>
          )}
          {topLate.map((row, i) => (
            <div
              key={row.employee!.id}
              className="flex items-center justify-between border-b border-border py-2.5 last:border-0"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{row.employee!.name}</p>
                  <p className="text-xs text-muted-foreground">{row.employee!.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="warning">{row.minutes} {t.common.minutes}</Badge>
                <span className="text-xs text-muted-foreground">{row.count} {t.dashboard.times}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

async function EmployeeDashboard({ employeeId, userName }: { employeeId: string; userName: string }) {
  const db = await getDb();
  const t = await getT();
  const locale = await getLocale();
  const todayIso = todayDate();
  const ym = currentYearMonth();
  const employee = db.employees.find((e) => e.id === employeeId);
  const today = db.dailyAttendance.find((a) => a.employeeId === employeeId && a.date === todayIso);
  const period = db.payrollPeriods.find((p) => p.year === ym.year && p.month === ym.month);
  const payrollRecord = period
    ? db.payrollRecords.find((r) => r.employeeId === employeeId && r.periodId === period.id)
    : undefined;
  const upcomingLeaves = db.leaves.filter((l) => l.employeeId === employeeId && l.status === "approved" && l.to >= todayIso);
  const timeFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(locale === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${t.dashboard.welcome} ${userName}`} description={t.dashboard.employeeWelcomeDesc} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{t.dashboard.todayAttendance}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {today ? (
              <>
                <AttendanceStatusBadge status={today.status} />
                <p className="text-sm text-muted-foreground">
                  {timeFmt(today.actualIn)} {" → "} {timeFmt(today.actualOut)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t.dashboard.noPunchYetToday}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.dashboard.lastNetSalary}</CardTitle></CardHeader>
          <CardContent>
            {payrollRecord ? (
              <p className="text-2xl font-extrabold tabular-nums text-primary">{formatEGP(payrollRecord.netSalary, locale)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t.dashboard.payrollNotCalculatedShort}</p>
            )}
            <Link href="/payroll" className="mt-2 inline-block text-sm text-primary hover:underline">
              {t.dashboard.viewPayslip}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.dashboard.upcomingLeaves}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1">
            {upcomingLeaves.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.dashboard.noUpcomingLeaves}</p>
            ) : (
              upcomingLeaves.map((l) => (
                <p key={l.id} className="text-sm text-foreground">{l.from} → {l.to}</p>
              ))
            )}
            <Link href="/leaves" className="mt-2 inline-block text-sm text-primary hover:underline">
              {t.dashboard.requestNewLeave}
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.dashboard.basicInfo}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label={t.dashboard.employeeId} value={employee?.id ?? "-"} />
          <Field label={t.employees.formJobTitle} value={employee ? translateLabel(employee.jobTitle, locale) : "-"} />
          <Field label={t.dashboard.basicSalary} value={employee ? formatEGP(employee.basicSalary, locale) : "-"} />
          <Field label={t.dashboard.hireDate} value={employee?.hireDate ?? "-"} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
