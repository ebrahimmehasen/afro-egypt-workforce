import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { COMPANY, formatEGP } from "@/lib/constants";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { payrollBreakdownRows } from "@/lib/i18n/labels";
import { Separator } from "@/components/ui/separator";
import { PrintButton } from "@/components/payroll/print-button";

export default function PayslipPage({ params }: { params: { recordId: string } }) {
  const user = getSession();
  if (!user) redirect("/login");

  const db = getDb();
  const t = getT();
  const locale = getLocale();
  const record = db.payrollRecords.find((r) => r.id === params.recordId);
  if (!record) notFound();

  const employee = db.employees.find((e) => e.id === record.employeeId);
  const department = db.departments.find((d) => d.id === employee?.departmentId);
  const period = db.payrollPeriods.find((p) => p.id === record.periodId);
  if (!employee || !period) notFound();

  const breakdown = payrollBreakdownRows(record, t);

  return (
    <div className="min-h-screen bg-muted/30 py-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4">
        <div className="flex items-center justify-between no-print">
          <Link href={`/employees/${employee.id}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            {t.payslip.back}
          </Link>
          <PrintButton />
        </div>

        <div className="rounded-2xl border border-border bg-white p-8 shadow-elevated print:border-none print:shadow-none">
          <div className="flex items-center justify-between border-b border-border pb-6">
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-white ring-1 ring-border">
                <Image src={COMPANY.logo} alt={COMPANY.name} fill className="object-contain p-1" />
              </div>
              <div>
                <p className="text-lg font-extrabold text-foreground">{COMPANY.name}</p>
                <p className="text-xs text-muted-foreground">{COMPANY.productName}</p>
              </div>
            </div>
            <div className="text-end">
              <p className="text-lg font-bold text-foreground">{t.payslip.title}</p>
              <p className="text-xs text-muted-foreground">{translateLabel(period.label, locale)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-b border-border py-6 text-sm">
            <Field label={t.payslip.employeeName} value={employee.name} />
            <Field label={t.payslip.employeeId} value={employee.id} />
            <Field label={t.payslip.department} value={translateLabel(department?.name ?? "-", locale)} />
            <Field label={t.payslip.month} value={translateLabel(period.label, locale)} />
          </div>

          <div className="flex flex-col gap-2 py-6 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.payslip.earnings}</p>
            {breakdown.earnings.map((item) => (
              <Row key={item.label} label={item.label} amount={item.amount} locale={locale} />
            ))}
            <Separator className="my-2" />
            <Row label={t.payslip.total} amount={record.grossSalary} bold locale={locale} />

            <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.payslip.deductionsTitle}</p>
            {breakdown.deductions.map((item) => (
              <Row key={item.label} label={item.label} amount={item.amount} negative locale={locale} />
            ))}

            <Separator className="my-2" />
            <div className="flex items-center justify-between rounded-lg bg-primary/5 px-4 py-3">
              <span className="font-bold text-foreground">{t.payslip.netSalary}</span>
              <span dir="ltr" className="text-lg font-extrabold tabular-nums text-primary">{formatEGP(record.netSalary, locale)}</span>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-dashed border-border pt-4 text-[11px] text-muted-foreground">
            <span>{t.payslip.disclaimer} {COMPANY.name}</span>
            <div className="text-end">
              <p>{t.app.poweredBy}</p>
              <p className="italic">{COMPANY.slogan}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function Row({
  label, amount, bold, negative, locale,
}: { label: string; amount: number; bold?: boolean; negative?: boolean; locale: "ar" | "en" }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span dir="ltr" className={`tabular-nums ${negative ? "text-destructive" : ""}`}>
        {negative ? "-" : ""}
        {formatEGP(amount, locale)}
      </span>
    </div>
  );
}
