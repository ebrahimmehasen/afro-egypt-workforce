import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { inScope, viewerScope } from "@/lib/scope";
import { formatEGP } from "@/lib/constants";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { payrollBreakdownRows } from "@/lib/i18n/labels";
import { Separator } from "@/components/ui/separator";
import { PrintButton } from "@/components/payroll/print-button";

/** The browser prints the page title at the top of the sheet, so the payslip carries a neutral one of its own
 * instead of the app's (which names the company). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.payslip.title };
}

/**
 * A plain payslip: the employee, the period and every line of their pay — and nothing that identifies the
 * company (no logo, name, address, phone, header, footer or brand colours), on screen and when printed.
 */
export default async function PayslipPage({ params }: { params: Promise<{ recordId: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const db = await getDb();
  const t = await getT();
  const locale = await getLocale();
  const { recordId } = await params;
  const record = db.payrollRecords.find((r) => r.id === recordId);
  if (!record) notFound();
  if (!inScope(viewerScope(user, db.employees), record.employeeId)) notFound();

  const employee = db.employees.find((e) => e.id === record.employeeId);
  const department = db.departments.find((d) => d.id === employee?.departmentId);
  const period = db.payrollPeriods.find((p) => p.id === record.periodId);
  if (!employee || !period) notFound();

  const breakdown = payrollBreakdownRows(record, t);

  return (
    <div className="min-h-screen bg-white py-8 print:py-0">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4">
        <div className="flex items-center justify-between no-print">
          <Link href={`/employees/${employee.employeeNumber}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            {t.payslip.back}
          </Link>
          <PrintButton />
        </div>

        <div className="rounded-lg border border-border bg-white p-8 print:border-none print:p-0">
          <div className="border-b border-border pb-6">
            <p className="text-lg font-bold text-foreground">{t.payslip.title}</p>
            <p className="text-xs text-muted-foreground">{translateLabel(period.label, locale)}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 border-b border-border py-6 text-sm">
            <Field label={t.payslip.employeeName} value={employee.name} />
            <Field label={t.payslip.employeeId} value={employee.employeeNumber} />
            <Field label={t.payslip.department} value={translateLabel(department?.name ?? "-", locale)} />
            <Field label={t.payslip.month} value={translateLabel(period.label, locale)} />
          </div>

          <div className="flex flex-col gap-2 py-6 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.payslip.earnings}</p>
            {breakdown.earnings.map((item) => (
              <Row key={item.label} label={item.label} amount={item.amount} locale={locale} />
            ))}
            <Separator className="my-2" />
            <Row label={t.payslip.total} amount={breakdown.total} bold locale={locale} />
            <Row label={breakdown.overtime.label} amount={breakdown.overtime.amount} locale={locale} />

            <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.payslip.deductionsTitle}</p>
            {breakdown.deductions.map((item) => (
              <Row key={item.label} label={item.label} amount={item.amount} negative locale={locale} />
            ))}

            <Separator className="my-2" />
            <div className="flex items-center justify-between border-y border-border px-1 py-3">
              <span className="font-bold text-foreground">{t.payslip.netSalary}</span>
              <span dir="ltr" className="text-lg font-extrabold tabular-nums text-foreground">{formatEGP(record.netSalary, locale)}</span>
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
      <span dir="ltr" className="tabular-nums">
        {negative ? "-" : ""}
        {formatEGP(amount, locale)}
      </span>
    </div>
  );
}
