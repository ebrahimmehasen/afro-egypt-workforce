import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { isStaffRole, PERMISSION_KEYS } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { roleLabel } from "@/lib/i18n/labels";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { ResetPasswordDialog } from "@/components/users/reset-password-dialog";
import { PermissionsEditor } from "@/components/permissions/permissions-editor";

const stamp = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

export default async function UserDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("/users");
  const { id } = await params;
  const t = await getT();
  const locale = await getLocale();

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound();

  const [db, departments, allUsers] = await Promise.all([
    getDb(),
    prisma.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { employeeId: true } }),
  ]);

  const employee = user.employeeId ? db.employees.find((e) => e.id === user.employeeId) : undefined;
  const linkedElsewhere = new Set(allUsers.map((u) => u.employeeId).filter((e) => e && e !== user.employeeId));
  const employeeOpts = db.employees
    .filter((e) => !linkedElsewhere.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, jobTitle: e.jobTitle, label: `${e.name} (${e.employeeNumber})` }));

  const permissions = Array.isArray(user.permissions) ? (user.permissions as string[]) : [];
  const departmentIds = Array.isArray(user.departmentIds) ? (user.departmentIds as string[]) : [];
  const departmentOpts = departments.map((d) => ({ id: d.id, name: translateLabel(d.name, locale) }));

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: t.users.name, value: user.name },
    { label: t.users.email, value: <span dir="ltr">{user.email}</span> },
    { label: t.users.role, value: <Badge variant="secondary">{roleLabel(user.role, t)}</Badge> },
    {
      label: t.users.status,
      value: <Badge variant={user.active ? "success" : "destructive"}>{user.active ? t.users.active : t.users.inactive}</Badge>,
    },
    {
      label: t.users.linkedEmployee,
      value: employee ? (
        <Link href={`/employees/${employee.employeeNumber}`} className="text-primary hover:underline">
          {employee.name} ({employee.employeeNumber})
        </Link>
      ) : (
        "—"
      ),
    },
    { label: t.users.lastLogin, value: <span dir="ltr">{stamp(user.lastLoginAt)}</span> },
    { label: t.users.createdAt, value: <span dir="ltr">{stamp(user.createdAt)}</span> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/users" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="h-4 w-4 rtl:rotate-180" />
        {t.users.backToList}
      </Link>

      <PageHeader
        title={user.name}
        description={t.users.detailsTitle}
        actions={
          <>
            <ResetPasswordDialog userId={user.id} userName={user.name} labeled />
            <UserFormDialog
              labeled
              user={{ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, employeeId: user.employeeId }}
              employees={employeeOpts}
            />
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.users.detailsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <div key={f.label} className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="text-sm font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          {t.users.permissionsSection}
        </h2>
        {isStaffRole(user.role) ? (
          <PermissionsEditor
            // remount when the saved data changes — the checkbox state is seeded once on mount
            key={`${user.id}:${user.active}:${user.directEdit}:${permissions.join(",")}:${departmentIds.join(",")}`}
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              active: user.active,
              directEdit: user.directEdit,
              permissions,
              departmentIds,
            }}
            keys={PERMISSION_KEYS}
            departments={departmentOpts}
          />
        ) : (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">{t.users.noPermissionsForRole}</CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
