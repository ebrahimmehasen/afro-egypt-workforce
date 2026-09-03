import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, viewerScope } from "@/lib/scope";
import { canCorrectAttendance } from "@/lib/permissions";
import { getT, format } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { EmployeesTable } from "@/components/employees/employees-table";
import { EmployeeFormDialog } from "@/components/employees/employee-form-dialog";

export default async function EmployeesPage() {
  const db = await getDb();
  const user = await requireAccess("/employees");
  const t = await getT();
  const canEdit = canCorrectAttendance(user.role); // admin/hr can manage employee records

  const employees = employeesInScope(viewerScope(user, db.employees), db.employees);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.employees.title}
        description={format(t.employees.totalCount, { count: employees.length })}
        actions={canEdit ? <EmployeeFormDialog departments={db.departments} shifts={db.shifts} /> : null}
      />
      <EmployeesTable employees={employees} departments={db.departments} shifts={db.shifts} canEdit={canEdit} />
    </div>
  );
}
