import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDb } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { ResetPasswordDialog } from "@/components/users/reset-password-dialog";

export default async function UsersPage() {
  const authed = await requireSession();
  if (!canManageUsers(authed.role)) notFound();

  const t = await getT();
  const locale = await getLocale();
  const db = await getDb();

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const empName = new Map(db.employees.map((e) => [e.id, e.name]));
  const depName = new Map(db.departments.map((d) => [d.id, translateLabel(d.name, locale)]));

  const employeeOpts = db.employees.map((e) => ({ id: e.id, name: `${e.name} (${e.id})` }));
  const departmentOpts = db.departments.map((d) => ({ id: d.id, name: translateLabel(d.name, locale) }));

  const roleVariant: Record<string, "default" | "secondary" | "warning" | "success"> = {
    admin: "warning",
    hr: "success",
    supervisor: "default",
    employee: "secondary",
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.nav.users}
        description={t.users.description}
        actions={<UserFormDialog employees={employeeOpts} departments={departmentOpts} />}
      />

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.users.name}</TableHead>
              <TableHead>{t.users.email}</TableHead>
              <TableHead>{t.users.role}</TableHead>
              <TableHead>{t.users.scope}</TableHead>
              <TableHead>{t.users.status}</TableHead>
              <TableHead>{t.users.lastLogin}</TableHead>
              <TableHead className="text-end">{t.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell dir="ltr">{u.email}</TableCell>
                <TableCell><Badge variant={roleVariant[u.role]}>{t.roles[u.role]}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {u.employeeId ? empName.get(u.employeeId) ?? u.employeeId : ""}
                  {u.employeeId && u.departmentId ? " · " : ""}
                  {u.departmentId ? depName.get(u.departmentId) ?? u.departmentId : ""}
                  {!u.employeeId && !u.departmentId ? "—" : ""}
                </TableCell>
                <TableCell>
                  <Badge variant={u.active ? "success" : "destructive"}>
                    {u.active ? t.users.active : t.users.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground" dir="ltr">
                  {u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <ResetPasswordDialog userId={u.id} userName={u.name} />
                    <UserFormDialog
                      user={{
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role: u.role,
                        active: u.active,
                        employeeId: u.employeeId,
                        departmentId: u.departmentId,
                      }}
                      employees={employeeOpts}
                      departments={departmentOpts}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
