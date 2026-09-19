import Link from "next/link";
import { ChevronLeft } from "lucide-react";
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
import { ClickableRow } from "@/components/shared/clickable-row";
import { isStaffRole } from "@/lib/permissions";

export default async function UsersPage() {
  await requireAccess("/users");

  const t = await getT();
  const locale = await getLocale();
  const db = await getDb();

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const empNumber = new Map(db.employees.map((e) => [e.id, e.employeeNumber]));
  const depName = new Map(db.departments.map((d) => [d.id, translateLabel(d.name, locale)]));

  const employeeOpts = db.employees.map((e) => ({ id: e.id, name: e.name, jobTitle: e.jobTitle, label: `${e.name} (${e.employeeNumber})` }));
  const jobTitles = Array.from(new Set(db.employees.map((e) => e.jobTitle.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));
  const linkedEmployeeIds = new Set(users.map((u) => u.employeeId).filter(Boolean));
  const availableEmployeeOpts = employeeOpts.filter((e) => !linkedEmployeeIds.has(e.id));

  const roleVariant: Record<string, "default" | "secondary" | "warning" | "success"> = {
    admin: "warning",
    hr: "success",
    supervisor: "default",
    staff: "default",
    employee: "secondary",
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.nav.users}
        description={t.users.description}
        actions={<UserFormDialog employees={availableEmployeeOpts} jobTitles={jobTitles} />}
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
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <ClickableRow key={u.id} href={`/users/${u.id}`}>
                <TableCell className="font-medium">
                  <Link href={`/users/${u.id}`} className="hover:underline" aria-label={`${t.users.openDetails}: ${u.name}`}>{u.name}</Link>
                </TableCell>
                <TableCell dir="ltr">{u.email}</TableCell>
                <TableCell><Badge variant={roleVariant[u.role]}>{t.roles[u.role]}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {(() => {
                    const ids = Array.isArray(u.departmentIds) ? (u.departmentIds as string[]) : [];
                    const parts = [
                      u.employeeId ? empNumber.get(u.employeeId) ?? "" : "",
                      isStaffRole(u.role)
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
                <TableCell className="text-end text-muted-foreground">
                  <ChevronLeft className="inline h-4 w-4 ltr:rotate-180" />
                </TableCell>
              </ClickableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
