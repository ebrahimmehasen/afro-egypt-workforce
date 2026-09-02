"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { CalendarPlus } from "lucide-react";
import { openPayrollPeriod } from "@/lib/actions/payroll";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PayrollPeriod } from "@/lib/types";
import { translateLabel } from "@/lib/i18n/data-labels";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" disabled={pending} className="gap-2">
      <CalendarPlus className="h-4 w-4" />
      {t.payroll.openPeriod}
    </Button>
  );
}

export function PayrollPeriodBar({
  periods,
  currentId,
  canEdit,
}: {
  periods: PayrollPeriod[];
  currentId: string;
  canEdit: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(openPayrollPeriod, {});
  useActionFeedback(state, () => {
    setOpen(false);
    router.refresh();
  });

  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {periods.length > 1 && (
        <Select value={currentId} onValueChange={(v) => router.push(`/payroll?period=${v}`)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t.payroll.selectPeriod} />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {translateLabel(p.label, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2">
              <CalendarPlus className="h-4 w-4" />
              {t.payroll.openPeriod}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.payroll.openPeriodTitle}</DialogTitle>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pp-month">{t.payroll.month}</Label>
                  <select
                    id="pp-month"
                    name="month"
                    defaultValue={String(now.getMonth() + 1)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pp-year">{t.payroll.year}</Label>
                  <select
                    id="pp-year"
                    name="year"
                    defaultValue={String(now.getFullYear())}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <DialogFooter>
                <SubmitButton />
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
