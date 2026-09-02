"use client";

import { useMemo, useState } from "react";
import { Deduction, DeductionType, Employee } from "@/lib/types";
import { formatEGP } from "@/lib/constants";
import { deductionTypeLabel } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExportButtons } from "@/components/reports/export-buttons";
import { EmptyState } from "@/components/shared/empty-state";
import { MinusCircle } from "lucide-react";

const TYPE_OPTIONS: DeductionType[] = ["late", "absence", "early_leave", "penalty", "advance", "admin_deduction", "other"];

export function DeductionsReport({ deductions, employees }: { deductions: Deduction[]; employees: Employee[] }) {
  const t = useT();
  const locale = useLocale();
  const [type, setType] = useState("all");
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(
    () => deductions.filter((d) => type === "all" || d.type === type).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [deductions, type],
  );

  const exportRows = rows.map((d) => [
    empMap.get(d.employeeId)?.name ?? d.employeeId,
    deductionTypeLabel(d.type, t),
    d.amount,
    d.date,
    d.reason,
  ]);

  const total = rows.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t.reports.filterType}</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {TYPE_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>{deductionTypeLabel(value, t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ExportButtons
          filename="deductions-report"
          headers={[t.reports.colEmployee, t.reports.colType, t.reports.colAmount, t.reports.colDate, t.reports.colReason]}
          rows={exportRows}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={MinusCircle} title={t.reports.noMatch} />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.reports.colEmployee}</TableHead>
                  <TableHead>{t.reports.colType}</TableHead>
                  <TableHead>{t.reports.colAmount}</TableHead>
                  <TableHead>{t.reports.colDate}</TableHead>
                  <TableHead>{t.reports.colReason}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{empMap.get(d.employeeId)?.name ?? d.employeeId}</TableCell>
                    <TableCell><Badge variant="destructive">{deductionTypeLabel(d.type, t)}</Badge></TableCell>
                    <TableCell className="tabular-nums text-destructive">-{formatEGP(d.amount, locale)}</TableCell>
                    <TableCell>{d.date}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">{d.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-end text-sm font-semibold text-foreground">{t.reports.totalLabel} {formatEGP(total, locale)}</p>
        </>
      )}
    </div>
  );
}
