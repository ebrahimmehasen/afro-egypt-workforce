import { requireAccess } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { loadScheduleRows } from "@/lib/work-schedules";
import { PageHeader } from "@/components/shared/page-header";
import { WorkSchedulesSection } from "@/components/settings/pay-settings";

/**
 * الورديات = مواعيد العمل: the same list as the settings page (WorkSchedule), so one added or changed on either
 * page shows on both, and an employee on it is timed by it (their own custom times still win; with neither, their
 * pay type's times apply). Writing here needs the "shifts" permission and goes through gate().
 */
export default async function ShiftsPage() {
  const user = await requireAccess("/shifts");
  const t = await getT();
  const schedules = await loadScheduleRows();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.shifts.title} description={t.shifts.description} />
      <WorkSchedulesSection schedules={schedules} canManage={hasPermission(user, "shifts")} from="shifts" />
    </div>
  );
}
