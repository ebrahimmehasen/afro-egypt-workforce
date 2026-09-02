"use client";

import { useMemo, useState } from "react";
import { Employee, Overtime, RequestStatus } from "@/lib/types";
import { formatEGP } from "@/lib/constants";
import { requestStatusLabel } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RequestStatusBadge } from "@/components/shared/status-badge";
import { ExportButtons } from "@/components/reports/export-buttons";
import { EmptyState } from "@/components/shared/empty-state";
import { TimerReset } from "lucide-react";

const STATUS_OPTIONS: RequestStatus[] = ["pending", "approved", "rejected"];

export function OvertimeReport({ records, employees }: { records: Overtime[]; employees: Employee[] }) {
  const t = useT();
  const locale = useLocale();
  const [status, setStatus] = useState("all");
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(
    () => records.filter((o) => status === "all" || o.status === status).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [records, status],
  );

  const exportRows = rows.map((o) => [
    empMap.get(o.employeeId)?.name ?? o.employeeId,
    o.date,
    o.hours,
    o.hourlyRate,
    o.amount,
    requestStatusLabel(o.status, t),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t.reports.filterStatus}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {STATUS_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>{requestStatusLabel(value, t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ExportButtons
          filename="overtime-report"
          headers={[t.reports.colEmployee, t.reports.colDate, t.reports.colHours, t.reports.colRate, t.reports.colAmount, t.reports.colStatus]}
          rows={exportRows}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={TimerReset} title={t.reports.noMatch} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reports.colEmployee}</TableHead>
                <TableHead>{t.reports.colDate}</TableHead>
                <TableHead>{t.reports.colHours}</TableHead>
                <TableHead>{t.reports.colRate}</TableHead>
                <TableHead>{t.reports.colAmount}</TableHead>
                <TableHead>{t.reports.colStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{empMap.get(o.employeeId)?.name ?? o.employeeId}</TableCell>
                  <TableCell>{o.date}</TableCell>
                  <TableCell className="tabular-nums">{o.hours}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(o.hourlyRate, locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(o.amount, locale)}</TableCell>
                  <TableCell><RequestStatusBadge status={o.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
