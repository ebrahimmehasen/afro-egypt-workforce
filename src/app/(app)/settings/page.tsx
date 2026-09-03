import Image from "next/image";
import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { CompanySettingsForm, AttendanceSettingsForm, PayrollSettingsForm } from "@/components/settings/settings-forms";
import { Card, CardContent } from "@/components/ui/card";

export default async function SettingsPage() {
  await requireAccess("/settings");

  const db = await getDb();
  const t = await getT();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.settings.title} description={t.settings.description} />

      <Card>
        <CardContent className="flex items-center gap-4 p-5">
          <div className="relative h-16 w-16 overflow-hidden rounded-lg bg-white p-1 ring-1 ring-border">
            <Image src={db.companySettings.logoUrl} alt={db.companySettings.companyName} fill className="object-contain" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{db.companySettings.companyName}</p>
            <p className="text-sm text-muted-foreground">{t.settings.currentLogo}</p>
          </div>
        </CardContent>
      </Card>

      <CompanySettingsForm settings={db.companySettings} />
      <AttendanceSettingsForm settings={db.attendanceSettings} />
      <PayrollSettingsForm settings={db.payrollSettings} />
    </div>
  );
}
