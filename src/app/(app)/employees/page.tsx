import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canCorrectAttendance } from "@/lib/permissions";
import { getT, format } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { EmployeesTable } from "@/components/employees/employees-table";
import { EmployeeFormDialog } from "@/components/employees/employee-form-dialog";

export default function EmployeesPage() {
  const db = getDb();
  const user = getSession()!;
  const t = getT();
  const canEdit = canCorrectAttendance(user.role); // admin/hr can manage employee records

  let employees = db.employees;
  if (user.role === "supervisor" && user.departmentId) {
    employees = employees.filter((e) => e.departmentId === user.departmentId);
  }

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
