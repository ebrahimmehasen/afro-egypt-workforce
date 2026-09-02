"use client";

import { useState } from "react";
import Link from "next/link";
import { Receipt, ExternalLink } from "lucide-react";
import { PayrollRecord } from "@/lib/types";
import { formatEGP } from "@/lib/constants";
import { payrollBreakdownRows } from "@/lib/i18n/labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

export function BreakdownDialog({ record, employeeName }: { record: PayrollRecord; employeeName: string }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const breakdown = payrollBreakdownRows(record, t);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-primary">
          <Receipt className="h-4 w-4" />
          {t.payroll.viewBreakdown}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.payroll.breakdownTitle}</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 text-sm">
          {breakdown.earnings.map((item) => (
            <Row key={item.label} label={item.label} amount={item.amount} locale={locale} />
          ))}
          <Separator className="my-1" />
          <Row label={t.payroll.totalLabel} amount={record.grossSalary} bold locale={locale} />
          <Separator className="my-1" />
          {breakdown.deductions.map((item) => (
            <Row key={item.label} label={item.label} amount={-item.amount} locale={locale} />
          ))}
          <Separator className="my-1" />
          <Row label={t.payroll.netSalary} amount={record.netSalary} bold accent locale={locale} />
        </div>

        <DialogFooter>
          <Link href={`/payslip/${record.id}`}>
            <Button variant="outline" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              {t.payroll.openPayslip}
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label, amount, bold, accent, locale,
}: { label: string; amount: number; bold?: boolean; accent?: boolean; locale: "ar" | "en" }) {
  const negative = amount < 0;
  return (
    <div className={`flex items-center justify-between ${bold ? "font-bold" : ""}`}>
      <span className={accent ? "text-primary" : "text-foreground"}>{label}</span>
      <span
        className={`tabular-nums ${accent ? "text-primary" : negative ? "text-destructive" : "text-foreground"}`}
        dir="ltr"
      >
        {negative ? "-" : ""}
        {formatEGP(Math.abs(amount), locale)}
      </span>
    </div>
  );
}
