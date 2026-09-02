"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, MinusCircle } from "lucide-react";
import { Deduction, Employee } from "@/lib/types";
import { deleteDeduction } from "@/lib/actions/deductions";
import { formatEGP } from "@/lib/constants";
import { format } from "@/lib/i18n/format";
import { deductionTypeLabel } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";

export function DeductionsTable({
  deductions,
  employees,
  canManage,
  initialMonth = null,
  monthLabel,
}: {
  deductions: Deduction[];
  employees: Employee[];
  canManage: boolean;
  /** "YYYY-MM" to pre-filter by, e.g. from a dashboard KPI link (`?month=2026-08`). */
  initialMonth?: string | null;
  monthLabel?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(initialMonth);

  const rows = useMemo(
    () => (month ? deductions.filter((d) => d.date.startsWith(month)) : deductions),
    [deductions, month],
  );

  const filterLabel = monthLabel ?? month;

  if (deductions.length === 0) {
    return <EmptyState icon={MinusCircle} title={t.deductions.noDeductions} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {month && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">{format(t.common.filteredBy, { label: filterLabel ?? "" })}</span>
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setMonth(null)}
          >
            {t.common.clearFilter}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={MinusCircle} title={t.deductions.noDeductions} />
      ) : (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.deductions.colEmployee}</TableHead>
            <TableHead>{t.deductions.colType}</TableHead>
            <TableHead>{t.deductions.colAmount}</TableHead>
            <TableHead>{t.deductions.colDate}</TableHead>
            <TableHead>{t.deductions.colReason}</TableHead>
            {canManage && <TableHead className="text-end">{t.deductions.colActions}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => {
            const employee = empMap.get(d.employeeId);
            return (
              <TableRow key={d.id}>
                <TableCell>
                  <div className="font-medium">{employee?.name ?? d.employeeId}</div>
                  <div className="text-xs text-muted-foreground">{d.employeeId}</div>
                </TableCell>
                <TableCell><Badge variant="destructive">{deductionTypeLabel(d.type, t)}</Badge></TableCell>
                <TableCell className="tabular-nums font-medium text-destructive">-{formatEGP(d.amount, locale)}</TableCell>
                <TableCell>{d.date}</TableCell>
                <TableCell className="max-w-[220px] truncate text-muted-foreground">{d.reason}</TableCell>
                {canManage && (
                  <TableCell className="text-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await deleteDeduction(d.id);
                          if (res?.error) toast.error(res.error);
                          else toast.success(t.deductions.deletedDeduction);
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
