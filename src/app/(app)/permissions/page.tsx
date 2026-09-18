import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/auth";
import { PERMISSION_KEYS } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionsEditor } from "@/components/permissions/permissions-editor";
import { EmptyState } from "@/components/shared/empty-state";
import { KeyRound } from "lucide-react";

export default async function PermissionsPage() {
  await requireAccess("/permissions");
  const t = await getT();
  const locale = await getLocale();

  const [staff, departments] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: ["hr", "supervisor"] } }, orderBy: { createdAt: "asc" } }),
    prisma.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
  ]);
  const departmentOpts = departments.map((d) => ({ id: d.id, name: translateLabel(d.name, locale) }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.permissions.title} description={t.permissions.description} />

      {staff.length === 0 ? (
        <EmptyState icon={KeyRound} title={t.permissions.noStaffAccounts} />
      ) : (
        <div className="flex flex-col gap-4">
          {staff.map((u) => {
            const permissions = Array.isArray(u.permissions) ? (u.permissions as string[]) : [];
            const departmentIds = Array.isArray(u.departmentIds) ? (u.departmentIds as string[]) : [];
            return (
              <PermissionsEditor
                // remount when the server data actually changes (e.g. right after this
                // card's own save) — local checkbox state is seeded once on mount and
                // would otherwise keep showing what was on screen before the save.
                key={`${u.id}:${u.active}:${permissions.join(",")}:${departmentIds.join(",")}`}
                user={{
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  role: u.role,
                  active: u.active,
                  permissions,
                  departmentIds,
                }}
                keys={PERMISSION_KEYS}
                departments={departmentOpts}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
