import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canEditPayroll } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeductionFormDialog } from "@/components/deductions/deduction-form-dialog";
import { AllowanceFormDialog } from "@/components/deductions/allowance-form-dialog";
import { DeductionsTable } from "@/components/deductions/deductions-table";
import { AllowancesTable } from "@/components/deductions/allowances-table";

export default async function DeductionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const db = await getDb();
  const user = (await getSession())!;
  const t = await getT();
  const locale = await getLocale();
  const canManage = canEditPayroll(user.role);

  const initialMonth = (await searchParams).month ?? null;
  const monthPeriod = initialMonth
    ? db.payrollPeriods.find((p) => `${p.year}-${String(p.month).padStart(2, "0")}` === initialMonth)
    : undefined;
  const monthLabel = monthPeriod ? translateLabel(monthPeriod.label, locale) : initialMonth;

  const deductions = [...db.deductions].sort((a, b) => (a.date < b.date ? 1 : -1));
  const allowances = [...db.allowances];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.deductions.title} description={t.deductions.description} />

      <Tabs defaultValue="deductions">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="deductions">{t.deductions.tabDeductions}</TabsTrigger>
            <TabsTrigger value="allowances">{t.deductions.tabAllowances}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="deductions" className="flex flex-col gap-4">
          {canManage && <div className="flex justify-end"><DeductionFormDialog employees={db.employees} /></div>}
          <DeductionsTable
            key={initialMonth ?? "all"}
            deductions={deductions}
            employees={db.employees}
            canManage={canManage}
            initialMonth={initialMonth}
            monthLabel={monthLabel}
          />
        </TabsContent>

        <TabsContent value="allowances" className="flex flex-col gap-4">
          {canManage && <div className="flex justify-end"><AllowanceFormDialog employees={db.employees} /></div>}
          <AllowancesTable allowances={allowances} employees={db.employees} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
