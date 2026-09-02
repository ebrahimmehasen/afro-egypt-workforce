"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Calculator, CheckCircle2, Lock } from "lucide-react";
import { calculatePayroll, approvePayrollPeriod, closePayrollPeriod } from "@/lib/actions/payroll";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { PayrollPeriod } from "@/lib/types";

export function PeriodActions({ period, canEdit }: { period: PayrollPeriod; canEdit: boolean }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
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
      <Button variant="outline" disabled={pending} className="gap-2" onClick={() => run(() => closePayrollPeriod(period.id), t.payroll.closedMsg)}>
        <Lock className="h-4 w-4" />
        {t.payroll.close}
      </Button>
    );
  }
  return null;
}
