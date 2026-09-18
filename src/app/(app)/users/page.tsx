import { prisma } from "@/lib/prisma";
import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
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
  await requireAccess("/users");

  const t = await getT();
  const locale = await getLocale();
  const db = await getDb();

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const empNumber = new Map(db.employees.map((e) => [e.id, e.employeeNumber]));
  const depName = new Map(db.departments.map((d) => [d.id, translateLabel(d.name, locale)]));

  const employeeOpts = db.employees.map((e) => ({ id: e.id, name: e.name, label: `${e.name} (${e.employeeNumber})` }));
  const linkedEmployeeIds = new Set(users.map((u) => u.employeeId).filter(Boolean));
  const availableEmployeeOpts = employeeOpts.filter((e) => !linkedEmployeeIds.has(e.id));

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
        actions={<UserFormDialog employees={availableEmployeeOpts} />}
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
                  {(() => {
                    const ids = Array.isArray(u.departmentIds) ? (u.departmentIds as string[]) : [];
                    const parts = [
                      u.employeeId ? empNumber.get(u.employeeId) ?? "" : "",
                      u.role === "hr" || u.role === "supervisor"
                        ? ids.length === 0 ? t.common.allDepartments : ids.map((id) => depName.get(id) ?? id).join("، ")
                        : "",
                    ].filter(Boolean);
                    return parts.length ? parts.join(" · ") : "—";
                  })()}
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
                      }}
                      employees={employeeOpts.filter((e) => e.id === u.employeeId || !linkedEmployeeIds.has(e.id))}
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
