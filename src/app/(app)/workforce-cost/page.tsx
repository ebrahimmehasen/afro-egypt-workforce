import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { scopedSnapshot, viewerScope } from "@/lib/scope";
import { formatEGP } from "@/lib/constants";
import { currentYearMonth } from "@/lib/today";
import { getMonthlyKpis, getTopLateEmployees, getWorkforceCostByDepartment } from "@/lib/selectors";
import { getT, format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { monthYearLabel } from "@/lib/i18n/format";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CostByDepartmentChart } from "@/components/dashboard/charts";
import { Badge } from "@/components/ui/badge";
import { Wallet, TimerReset, TrendingDown, Clock3 } from "lucide-react";

export default async function WorkforceCostPage() {
  const user = await requireAccess("/workforce-cost");
  const fullDb = await getDb();
  const scope = viewerScope(user, fullDb.employees);
  const db = scopedSnapshot(scope, fullDb);
  const t = await getT();
  const locale = await getLocale();
  const ym = currentYearMonth();
  const monthPrefix = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const monthly = await getMonthlyKpis(scope, ym.year, ym.month);
  const byDept = (await getWorkforceCostByDepartment(scope, ym.year, ym.month)).map((d) => ({ ...d, department: translateLabel(d.department, locale) }));
  const topLate = await getTopLateEmployees(scope, 5, 30);

  const totalCost = monthly.totalPayroll + monthly.overtimeTotal;

  const topOvertimeDept = [...byDept].sort((a, b) => b.overtime - a.overtime);
  const deptLateMinutes = db.departments.map((dept) => {
    const ids = new Set(db.employees.filter((e) => e.departmentId === dept.id).map((e) => e.id));
    const minutes = db.dailyAttendance
      .filter((a) => ids.has(a.employeeId) && a.date.startsWith(monthPrefix))
      .reduce((sum, a) => sum + a.deductibleLateMinutes, 0);
    return { department: translateLabel(dept.name, locale), minutes };
  }).sort((a, b) => b.minutes - a.minutes);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.workforceCost.title}
        description={format(t.workforceCost.description, { month: monthYearLabel(ym.year, ym.month, locale) })}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t.workforceCost.totalCost} value={formatEGP(totalCost, locale)} icon={Wallet} tone="primary" />
        <KpiCard label={t.workforceCost.totalPayroll} value={formatEGP(monthly.totalPayroll, locale)} icon={Wallet} tone="default" />
        <KpiCard label={t.workforceCost.overtime} value={formatEGP(monthly.overtimeTotal, locale)} icon={TimerReset} tone="success" />
        <KpiCard label={t.workforceCost.absenceLateCost} value={formatEGP(monthly.absenceCost + monthly.lateCost, locale)} icon={TrendingDown} tone="destructive" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.workforceCost.costByDept}</CardTitle>
          <CardDescription>{monthly.payrollCalculated ? t.workforceCost.calculatedNote : t.workforceCost.calculateFirstNote}</CardDescription>
        </CardHeader>
        <CardContent>
          <CostByDepartmentChart data={byDept} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t.workforceCost.topLateDepts}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1">
            {deptLateMinutes.map((row, i) => (
              <div key={row.department} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{i + 1}</span>
                  <span className="text-sm font-medium">{row.department}</span>
                </div>
                <Badge variant="warning">{row.minutes} {t.common.minutes}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.workforceCost.topOvertimeDepts}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1">
            {topOvertimeDept.map((row, i) => (
              <div key={row.department} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{i + 1}</span>
                  <span className="text-sm font-medium">{row.department}</span>
                </div>
                <Badge variant="success">{formatEGP(row.overtime, locale)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t.workforceCost.topLateEmployees}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1">
          {topLate.map((row, i) => (
            <div key={row.employee!.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{row.employee!.name}</p>
                  <p className="text-xs text-muted-foreground">{row.employee!.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                <Badge variant="warning">{row.minutes} {t.common.minutes}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
