import Image from "next/image";
import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { CompanySettingsForm } from "@/components/settings/settings-forms";
import { Card, CardContent } from "@/components/ui/card";
import { HolidaysCard } from "@/components/settings/holidays-card";
import { GeneralPaySection, PayRulesSection, PayTypesSection, WorkSchedulesSection } from "@/components/settings/pay-settings";
import { EvaluationScaleSection, JobLevelsSection } from "@/components/settings/evaluation-settings";
import { prisma } from "@/lib/prisma";
import { loadScheduleRows } from "@/lib/work-schedules";
import { dayStr } from "@/lib/serialize";
import { today } from "@/lib/today";
import { toPayTypeRules } from "@/lib/pay-context";
import { parseWeeklyOffDays } from "@/lib/pay-engine";

export default async function SettingsPage() {
  const user = await requireAccess("/settings");

  const db = await getDb();
  const t = await getT();
  const [holidays, payTypes, schedules] = await Promise.all([
    prisma.holiday.findMany({ orderBy: { from: "desc" } }),
    prisma.payType.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { employees: { where: { deletedAt: null } } } } },
    }),
    loadScheduleRows(),
  ]);
  // Pay types, schedules and rules decide how everyone is paid: only the main admin changes them.
  const canManagePay = user.role === "admin";
  // Job levels and the rating scale are evaluation-only (see /evaluation): same admin-only gate, loaded only for
  // the admin so the data is never even fetched for anyone else.
  const [jobLevels, scaleItems] = canManagePay
    ? await Promise.all([
        prisma.jobLevel.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { changes: true } } } }),
        prisma.evaluationScaleItem.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { reviews: true } } } }),
      ])
    : [[], []];
  const payTypeRows = payTypes.map((p) => ({
    ...toPayTypeRules(p),
    active: p.active,
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    employees: p._count.employees,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.settings.title} description={t.settings.description} />

      <Card>
        <CardContent className="flex items-center gap-4 p-5">
          <div className="relative h-16 w-16 overflow-hidden rounded-lg bg-white p-1 ring-1 ring-border">
            <Image src={db.companySettings.logoUrl} alt={db.companySettings.companyName} fill sizes="64px" className="object-contain" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{db.companySettings.companyName}</p>
            <p className="text-sm text-muted-foreground">{t.settings.currentLogo}</p>
          </div>
        </CardContent>
      </Card>

      <CompanySettingsForm settings={db.companySettings} />
      <PayTypesSection
        canManage={canManagePay}
        payTypes={payTypeRows}
      />
      <WorkSchedulesSection
        canManage={canManagePay}
        schedules={schedules}
      />
      <PayRulesSection
        canManage={canManagePay}
        payTypes={payTypeRows}
      />
      <GeneralPaySection
        canManage={canManagePay}
        weeklyOffDays={parseWeeklyOffDays(db.attendanceSettings.weeklyOffDays)}
        payPeriodStartDay={db.payrollSettings.payPeriodStartDay}
      />
      <HolidaysCard
        holidays={holidays.map((h) => ({ id: h.id, name: h.name, from: dayStr(h.from), to: dayStr(h.to) }))}
        today={today()}
      />
      {canManagePay && (
        <>
          <JobLevelsSection levels={jobLevels.map((l) => ({ id: l.id, name: l.name, sortOrder: l.sortOrder, inUse: l._count.changes > 0 }))} />
          <EvaluationScaleSection items={scaleItems.map((s) => ({ id: s.id, label: s.label, sortOrder: s.sortOrder, inUse: s._count.reviews > 0 }))} />
        </>
      )}
    </div>
  );
}
