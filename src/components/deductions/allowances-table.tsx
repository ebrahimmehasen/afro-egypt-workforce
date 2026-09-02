"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Gift } from "lucide-react";
import { Allowance, Employee } from "@/lib/types";
import { deleteAllowance } from "@/lib/actions/allowances";
import { formatEGP } from "@/lib/constants";
import { allowanceTypeLabel } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";

export function AllowancesTable({
  allowances,
  employees,
  canManage,
}: {
  allowances: Allowance[];
  employees: Employee[];
  canManage: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const [pending, startTransition] = useTransition();

  if (allowances.length === 0) {
    return <EmptyState icon={Gift} title={t.deductions.noAllowances} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.deductions.colEmployee}</TableHead>
            <TableHead>{t.deductions.colType}</TableHead>
            <TableHead>{t.deductions.colAmount}</TableHead>
            <TableHead>{t.deductions.colFrequency}</TableHead>
            {canManage && <TableHead className="text-end">{t.deductions.colActions}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {allowances.map((a) => {
            const employee = empMap.get(a.employeeId);
            return (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="font-medium">{employee?.name ?? a.employeeId}</div>
                  <div className="text-xs text-muted-foreground">{a.employeeId}</div>
                </TableCell>
                <TableCell><Badge variant="gold">{allowanceTypeLabel(a.type, t)}</Badge></TableCell>
                <TableCell className="tabular-nums font-medium text-success">+{formatEGP(a.amount, locale)}</TableCell>
                <TableCell className="text-muted-foreground">{a.monthly ? t.deductions.monthly : t.deductions.oneTime}</TableCell>
                {canManage && (
                  <TableCell className="text-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await deleteAllowance(a.id);
                          if (res?.error) toast.error(res.error);
                          else toast.success(t.deductions.deletedAllowance);
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
  );
}
