import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, rowsInScope, viewerScope } from "@/lib/scope";
import { hasPermission } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { MissionFormDialog } from "@/components/missions/mission-form-dialog";
import { MissionsTable } from "@/components/missions/missions-table";

export default async function MissionsPage() {
  const db = await getDb();
  const user = await requireAccess("/missions");
  const t = await getT();

  const scope = viewerScope(user, db.employees);
  const employees = employeesInScope(scope, db.employees);
  const missions = rowsInScope(scope, db.missions).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const canManage = hasPermission(user, "missions");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.missions.title}
        description={t.missions.description}
        actions={canManage ? <MissionFormDialog employees={employees} /> : undefined}
      />
      <MissionsTable missions={missions} employees={db.employees} canManage={canManage} />
    </div>
  );
}
