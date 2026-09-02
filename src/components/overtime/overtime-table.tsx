"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, X, TimerReset } from "lucide-react";
import { Overtime, Employee, RequestStatus } from "@/lib/types";
import { decideOvertime } from "@/lib/actions/overtime";
import { formatEGP } from "@/lib/constants";
import { requestStatusLabel } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { RequestStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";

const STATUS_OPTIONS: RequestStatus[] = ["pending", "approved", "rejected"];

export function OvertimeTable({
  records,
  employees,
  canApprove,
  initialStatus = "all",
}: {
  records: Overtime[];
  employees: Employee[];
  canApprove: boolean;
  /** Status filter to pre-select, e.g. from a dashboard KPI link (`?status=approved`). */
  initialStatus?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus);

  const rows = useMemo(
    () => records.filter((o) => status === "all" || o.status === status),
    [records, status],
  );

  function decide(id: string, decision: "approved" | "rejected") {
    startTransition(async () => {
      const res = await decideOvertime(id, decision);
      if (res?.error) toast.error(res.error);
      else toast.success(decision === "approved" ? t.overtime.approved : t.overtime.rejected);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.allStatuses}</SelectItem>
            {STATUS_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>{requestStatusLabel(value, t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={TimerReset} title={t.overtime.noRecords} />
      ) : (
      <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.overtime.colEmployee}</TableHead>
            <TableHead>{t.overtime.colDate}</TableHead>
            <TableHead>{t.overtime.colHours}</TableHead>
            <TableHead>{t.overtime.colRate}</TableHead>
            <TableHead>{t.overtime.colAmount}</TableHead>
            <TableHead>{t.overtime.colStatus}</TableHead>
            {canApprove && <TableHead className="text-end">{t.overtime.colActions}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((o) => {
            const employee = empMap.get(o.employeeId);
            return (
              <TableRow key={o.id}>
                <TableCell>
                  <div className="font-medium">{employee?.name ?? o.employeeId}</div>
                  <div className="text-xs text-muted-foreground">{o.employeeId}</div>
                </TableCell>
                <TableCell>{o.date}</TableCell>
                <TableCell className="tabular-nums">{o.hours}</TableCell>
                <TableCell className="tabular-nums">{formatEGP(o.hourlyRate, locale)}</TableCell>
                <TableCell className="tabular-nums font-medium">{formatEGP(o.amount, locale)}</TableCell>
                <TableCell><RequestStatusBadge status={o.status} /></TableCell>
                {canApprove && (
                  <TableCell className="text-end">
                    {o.status === "pending" ? (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="text-success" disabled={pending} onClick={() => decide(o.id, "approved")}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" disabled={pending} onClick={() => decide(o.id, "rejected")}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
      )}
    </div>
  );
}
