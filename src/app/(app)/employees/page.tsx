import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, viewerScope } from "@/lib/scope";
import { missingDocumentTypes, requiredDocumentTypes } from "@/lib/documents";
import { missingAcknowledgmentKeys, requiredAcknowledgmentKeys } from "@/lib/acknowledgments";
import { canUseAssistant, hasPermission } from "@/lib/permissions";
import { getT, format } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { EmployeesTable } from "@/components/employees/employees-table";
import { EmployeeFormDialog } from "@/components/employees/employee-form-dialog";
import { employeeFormOptions, loadPayContext } from "@/lib/pay-context";
import { EmployeeAssistant } from "@/components/assistant/employee-assistant";

export default async function EmployeesPage() {
  const db = await getDb();
  const user = await requireAccess("/employees");
  const t = await getT();
  const canEdit = hasPermission(user, "employees");

  const employees = employeesInScope(viewerScope(user, db.employees), db.employees);
  const formOptions = employeeFormOptions(await loadPayContext());

  const incompleteDocIds = employees
    .filter((e) => {
      const missingDocs = missingDocumentTypes(db.employeeDocuments.filter((d) => d.employeeId === e.id), requiredDocumentTypes(e));
      const missingAcks = missingAcknowledgmentKeys(db.employeeAcknowledgments.filter((a) => a.employeeId === e.id), requiredAcknowledgmentKeys(e));
      return missingDocs.length > 0 || missingAcks.length > 0;
    })
    .map((e) => e.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.employees.title}
        description={format(t.employees.totalCount, { count: employees.length })}
        actions={canEdit ? <EmployeeFormDialog departments={db.departments} shifts={db.shifts} {...formOptions} /> : null}
      />
      <EmployeesTable
        employees={employees}
        departments={db.departments}
        shifts={db.shifts}
        incompleteDocIds={incompleteDocIds}
      />
      {canUseAssistant(user) && <EmployeeAssistant />}
    </div>
  );
}
