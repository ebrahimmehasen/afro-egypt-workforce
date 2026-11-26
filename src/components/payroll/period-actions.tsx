"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Calculator, CheckCircle2, Lock } from "lucide-react";
import { calculatePayroll, approvePayrollPeriod, closePayrollPeriod, previewPayrollRecalculation } from "@/lib/actions/payroll";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PayrollPeriod } from "@/lib/types";
import { formatEGP } from "@/lib/constants";
import type { RecalculationChange } from "@/lib/payroll-recalc";

export function PeriodActions({ period, canEdit }: { period: PayrollPeriod; canEdit: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [changes, setChanges] = useState<RecalculationChange[] | null>(null);
  if (!canEdit) return null;

  function run(action: () => Promise<{ error?: string } | undefined>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else toast.success(success);
    });
  }

  if (period.status === "draft") {
    return (
      <Button disabled={pending} className="gap-2" onClick={() => run(() => calculatePayroll(period.id), t.payroll.calculated)}>
        <Calculator className="h-4 w-4" />
        {t.payroll.calculate}
      </Button>
    );
  }
  if (period.status === "calculated") {
    return (
      <div className="flex gap-2">
        <Button variant="outline" disabled={pending} className="gap-2" onClick={() => run(() => calculatePayroll(period.id), t.payroll.recalculated)}>
          <Calculator className="h-4 w-4" />
          {t.payroll.recalculate}
        </Button>
        <Button disabled={pending} className="gap-2" onClick={() => run(() => approvePayrollPeriod(period.id), t.payroll.approvedMsg)}>
          <CheckCircle2 className="h-4 w-4" />
          {t.payroll.approve}
        </Button>
      </div>
    );
  }
  if (period.status === "approved") {
    return (
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={pending}
          className="gap-2"
          onClick={() => {
            startTransition(async () => {
              const result = await previewPayrollRecalculation(period.id);
              if (result.length === 0) toast.success(t.payroll.recalcNoChanges);
              else setChanges(result);
            });
          }}
        >
          <Calculator className="h-4 w-4" />
          {t.payroll.recalculate}
        </Button>
        <Button variant="outline" disabled={pending} className="gap-2" onClick={() => run(() => closePayrollPeriod(period.id), t.payroll.closedMsg)}>
          <Lock className="h-4 w-4" />
          {t.payroll.close}
        </Button>

        <AlertDialog open={changes !== null} onOpenChange={(open) => !open && setChanges(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.payroll.recalcReviewTitle}</AlertDialogTitle>
              <AlertDialogDescription>{t.payroll.recalcReviewDesc}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{t.payroll.colEmployee}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.payroll.recalcOld}</th>
                    <th className="px-3 py-2 text-start font-medium">{t.payroll.recalcNew}</th>
                  </tr>
                </thead>
                <tbody>
                  {changes?.map((c) => (
                    <tr key={c.employeeId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2 tabular-nums" dir="ltr">{formatEGP(c.oldNetSalary, locale)}</td>
                      <td className="px-3 py-2 font-medium tabular-nums" dir="ltr">{formatEGP(c.newNetSalary, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.payroll.recalcCancel}</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={() => {
                  setChanges(null);
                  run(() => calculatePayroll(period.id), t.payroll.recalculated);
                }}
              >
                {t.payroll.recalcConfirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }
  return null;
}
