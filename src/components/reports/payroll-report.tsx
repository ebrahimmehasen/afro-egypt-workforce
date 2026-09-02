"use client";

import { Employee, PayrollRecord } from "@/lib/types";
import { formatEGP } from "@/lib/constants";
import { useLocale, useT } from "@/components/providers/locale-provider";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExportButtons } from "@/components/reports/export-buttons";
import { EmptyState } from "@/components/shared/empty-state";
import { Wallet } from "lucide-react";

export function PayrollReport({
  records,
  employees,
  periodLabel,
}: {
  records: PayrollRecord[];
  employees: Employee[];
  periodLabel: string;
}) {
  const t = useT();
  const locale = useLocale();
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const rows = [...records].sort((a, b) =>
    (empMap.get(a.employeeId)?.name ?? "").localeCompare(empMap.get(b.employeeId)?.name ?? "", locale === "ar" ? "ar" : "en"),
  );

  const exportRows = rows.map((r) => [
    empMap.get(r.employeeId)?.name ?? r.employeeId,
    r.basicSalary,
    r.allowances,
    r.overtimeAmount,
    r.grossSalary,
    r.totalDeductions,
    r.netSalary,
  ]);

  if (rows.length === 0) {
    return <EmptyState icon={Wallet} title={t.reports.notCalculatedYet} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t.reports.period} {periodLabel}</p>
        <ExportButtons
          filename="payroll-report"
          headers={[
            t.reports.colEmployee, t.reports.colBasic, t.reports.colAllowances, t.reports.colOvertime,
            t.reports.colGross, t.reports.colDeductions, t.reports.colNet,
          ]}
          rows={exportRows}
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.reports.colEmployee}</TableHead>
              <TableHead>{t.reports.colBasic}</TableHead>
              <TableHead>{t.reports.colAllowances}</TableHead>
              <TableHead>{t.reports.colOvertime}</TableHead>
              <TableHead>{t.reports.colGross}</TableHead>
              <TableHead>{t.reports.colDeductions}</TableHead>
              <TableHead>{t.reports.colNet}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{empMap.get(r.employeeId)?.name ?? r.employeeId}</TableCell>
                <TableCell className="tabular-nums">{formatEGP(r.basicSalary, locale)}</TableCell>
                <TableCell className="tabular-nums">{formatEGP(r.allowances, locale)}</TableCell>
                <TableCell className="tabular-nums">{formatEGP(r.overtimeAmount, locale)}</TableCell>
                <TableCell className="tabular-nums">{formatEGP(r.grossSalary, locale)}</TableCell>
                <TableCell className="tabular-nums text-destructive">-{formatEGP(r.totalDeductions, locale)}</TableCell>
                <TableCell className="tabular-nums font-bold">{formatEGP(r.netSalary, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
