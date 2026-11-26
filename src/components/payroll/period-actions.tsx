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
import { APP_TIME_ZONE, format, intlLocale } from "@/lib/i18n/format";
import { deductionTypeLabel, allowanceTypeLabel, overtimeKindLabel } from "@/lib/i18n/labels";
import type { RecalculationChange, RecalculationReason } from "@/lib/payroll-recalc";
import type { Dictionary } from "@/lib/i18n/dictionary";

function reasonLine(reason: RecalculationReason, t: Dictionary, locale: "ar" | "en"): string {
  if (reason.source === "generic") return t.payroll.recalcReasonGeneric;

  const verb = { created: t.payroll.recalcReasonCreated, edited: t.payroll.recalcReasonEdited, voided: t.payroll.recalcReasonVoided }[reason.action];
  const kind =
    reason.source === "deduction" ? deductionTypeLabel(reason.type, t)
    : reason.source === "allowance" ? allowanceTypeLabel(reason.type, t)
    : overtimeKindLabel(reason.kind, t);
  const amount =
    reason.action === "edited" && reason.oldAmount !== undefined
      ? `${formatEGP(reason.oldAmount, locale)} → ${formatEGP(reason.amount, locale)}`
      : formatEGP(reason.amount, locale);
  const when = new Date(reason.at).toLocaleString(intlLocale(locale), { timeZone: APP_TIME_ZONE });
  const by = reason.actorName ? format(t.payroll.recalcReasonBy, { name: reason.actorName }) : "";

  return [`${verb} — ${kind} — ${amount} — ${reason.date}`, by, when].filter(Boolean).join(" — ");
}

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
            <div className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-md border border-border p-3">
              {changes?.map((c) => (
                <div key={c.employeeId} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="tabular-nums" dir="ltr">
                      {formatEGP(c.oldNetSalary, locale)} → <span className="font-medium">{formatEGP(c.newNetSalary, locale)}</span>
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div className="font-medium">{t.payroll.recalcReasonsTitle}</div>
                    <ul className="list-inside list-disc">
                      {c.reasons.map((r, i) => <li key={i}>{reasonLine(r, t, locale)}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
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
