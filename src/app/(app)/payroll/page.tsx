import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { hasPermission, isSelfService } from "@/lib/permissions";
import { formatEGP } from "@/lib/constants";
import { today } from "@/lib/today";
import { payday, payPeriodOf, payPeriodRange } from "@/lib/pay-rules";
import { missingDocumentTypes, requiredDocumentTypes } from "@/lib/documents";
import { intlLocale } from "@/lib/i18n/format";
import { getT, format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { payrollPeriodStatusLabel } from "@/lib/i18n/labels";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PeriodActions } from "@/components/payroll/period-actions";
import { PayrollPeriodBar } from "@/components/payroll/payroll-period-bar";
import { BreakdownDialog } from "@/components/payroll/breakdown-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { FileWarning, Wallet } from "lucide-react";
import Link from "next/link";

const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "outline"> = {
  draft: "secondary",
  calculated: "warning",
  approved: "success",
  closed: "outline",
};

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const db = await getDb();
  const user = await requireAccess("/payroll");
  const t = await getT();
  const locale = await getLocale();
  const canEdit = hasPermission(user, "payroll");

  const { period: periodParam } = await searchParams;
  // the pay month runs 26th to 25th, so from the 26th on the current one is already next month's
  const ym = payPeriodOf(today());
  let period = periodParam ? db.payrollPeriods.find((p) => p.id === periodParam) : undefined;
  if (!period) {
    period =
      db.payrollPeriods.find((p) => p.year === ym.year && p.month === ym.month) ??
      db.payrollPeriods[0]; // list is ordered newest-first
  }

  let records = period
    ? db.payrollRecords
        .filter((r) => r.periodId === period!.id)
        .map((r) => ({ record: r, employee: db.employees.find((e) => e.id === r.employeeId) }))
        .filter((x) => x.employee)
        .sort((a, b) => a.employee!.name.localeCompare(b.employee!.name, locale === "ar" ? "ar" : "en"))
    : [];

  if (isSelfService(user) && user.employeeId) {
    records = records.filter((r) => r.employee!.id === user.employeeId);
  }

  const totalNet = records.reduce((s, r) => s + r.record.netSalary, 0);

  // the bylaws: pay is only settled once the hiring documents are complete — flagged here, not withheld
  const incompleteDocs = isSelfService(user)
    ? []
    : db.employees
        .filter((e) => e.status !== "terminated")
        .filter(
          (e) => missingDocumentTypes(db.employeeDocuments.filter((d) => d.employeeId === e.id), requiredDocumentTypes(e)).length > 0,
        )
        .sort((a, b) => a.name.localeCompare(b.name, locale === "ar" ? "ar" : "en"));

  const dayFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", timeZone: "UTC" });
  const showDay = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));
  const range = period ? payPeriodRange(period.year, period.month) : null;
  const payDay = period ? payday(period.year, period.month) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t.payroll.title} description={t.payroll.description} />
        {canEdit && (
          <PayrollPeriodBar
            periods={db.payrollPeriods}
            currentId={period?.id ?? ""}
            canEdit={canEdit}
          />
        )}
      </div>

      {period ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-lg font-bold text-foreground">{translateLabel(period.label, locale)}</p>
                {range && payDay && (
                  <p className="text-sm text-muted-foreground">
                    {format(t.payroll.periodRange, { from: showDay(range.from), to: showDay(range.to), payday: showDay(payDay) })}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {records.length > 0
                    ? `${format(t.payroll.employeesCount, { count: records.length })} — ${t.payroll.totalNet} ${formatEGP(totalNet, locale)}`
                    : t.payroll.trialNote}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[period.status]}>{payrollPeriodStatusLabel(period.status, t)}</Badge>
            </div>
            <PeriodActions period={period} canEdit={canEdit} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState icon={Wallet} title={t.payroll.noPeriods} />
      )}

      {incompleteDocs.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col gap-2 p-5">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <FileWarning className="h-5 w-5 text-warning" />
              {format(t.payroll.incompleteDocsTitle, { count: incompleteDocs.length })}
            </p>
            <p className="text-sm text-muted-foreground">{t.payroll.incompleteDocsDesc}</p>
            <div className="flex flex-wrap gap-1.5">
              {incompleteDocs.map((e) => (
                <Link key={e.id} href={`/employees/${e.employeeNumber}`}>
                  <Badge variant="outline" className="hover:bg-muted">{e.name}</Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {records.length === 0 ? (
        <EmptyState icon={Wallet} title={t.payroll.notCalculatedYet} description={t.payroll.notCalculatedYetDesc} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.payroll.colEmployee}</TableHead>
                <TableHead>{t.payroll.colBasic}</TableHead>
                <TableHead>{t.payroll.colAllowances}</TableHead>
                <TableHead>{t.payroll.colOvertime}</TableHead>
                <TableHead>{t.payroll.colGross}</TableHead>
                <TableHead>{t.payroll.colDeductions}</TableHead>
                <TableHead>{t.payroll.colNet}</TableHead>
                <TableHead className="text-end">{t.payroll.colDetails}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map(({ record, employee }) => (
                <TableRow key={record.id}>
                  <TableCell>
                    <div className="font-medium">{employee!.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {employee!.employeeNumber}
                      {record.paidDaysCount != null && (
                        <span className="ms-1.5 text-primary">
                          · {t.employees.salaryDaily} ({record.paidDaysCount} {t.common.days})
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatEGP(record.basicSalary, locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(record.allowances, locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(record.overtimeAmount, locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(record.grossSalary, locale)}</TableCell>
                  <TableCell className="tabular-nums text-destructive">-{formatEGP(record.totalDeductions, locale)}</TableCell>
                  <TableCell className="tabular-nums font-bold">{formatEGP(record.netSalary, locale)}</TableCell>
                  <TableCell className="text-end">
                    <BreakdownDialog record={record} employeeName={employee!.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
