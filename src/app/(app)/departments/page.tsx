import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { canManageSettings, canCorrectAttendance } from "@/lib/permissions";
import { formatEGP } from "@/lib/constants";
import { getAttendanceByDepartment } from "@/lib/selectors";
import { getT, format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DepartmentFormDialog } from "@/components/departments/department-form-dialog";
import { DeleteDepartmentButton } from "@/components/departments/delete-department-button";
import { Building2, Users, Wallet, Percent } from "lucide-react";

export default async function DepartmentsPage() {
  const db = await getDb();
  const user = await requireAccess("/departments");
  const t = await getT();
  const locale = await getLocale();
  const canEdit = canCorrectAttendance(user.role);
  const rates = await getAttendanceByDepartment();

  const rows = db.departments.map((dept) => {
    const employees = db.employees.filter((e) => e.departmentId === dept.id);
    const payrollRecords = db.payrollRecords.filter((r) => employees.some((e) => e.id === r.employeeId));
    const cost = payrollRecords.reduce((sum, r) => sum + r.netSalary, 0);
    const rate = rates.find((r) => r.department === dept.name)?.rate ?? 0;
    return { dept, employeeCount: employees.length, cost, rate };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.departments.title}
        description={format(t.departments.totalCount, { count: db.departments.length })}
        actions={canManageSettings(user.role) ? <DepartmentFormDialog /> : null}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ dept, employeeCount, cost, rate }) => (
          <Card key={dept.id}>
            <CardContent className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{translateLabel(dept.name, locale)}</p>
                    <p className="text-xs text-muted-foreground">{dept.managerName}</p>
                  </div>
                </div>
                {canManageSettings(user.role) && (
                  <div className="flex items-center">
                    <DepartmentFormDialog department={dept} />
                    <DeleteDepartmentButton id={dept.id} name={translateLabel(dept.name, locale)} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat icon={Users} label={t.departments.statEmployees} value={String(employeeCount)} />
                <Stat icon={Wallet} label={t.departments.statPayrollCost} value={formatEGP(cost, locale)} />
                <Stat icon={Percent} label={t.departments.statAttendanceRate} value={`${rate}%`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
