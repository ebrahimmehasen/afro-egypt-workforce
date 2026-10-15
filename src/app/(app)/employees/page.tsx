import Link from "next/link";
import { Clock3 } from "lucide-react";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, viewerScope } from "@/lib/scope";
import { missingDocumentTypes, requiredDocumentTypes } from "@/lib/documents";
import { missingAcknowledgmentKeys, requiredAcknowledgmentKeys } from "@/lib/acknowledgments";
import { canUseAssistant, hasPermission } from "@/lib/permissions";
import { isArchived } from "@/lib/employee-order";
import { EmployeesView } from "@/components/employees/employees-view";
import { EmployeeFormDialog } from "@/components/employees/employee-form-dialog";
import { employeeFormOptions, loadPayContext } from "@/lib/pay-context";
import { EmployeeAssistant } from "@/components/assistant/employee-assistant";

export default async function EmployeesPage() {
  const db = await getDb();
  const user = await requireAccess("/employees");
  const canEdit = hasPermission(user, "employees");
  // "كشف الإضافي" is the overtime page's statement: shown only to who may open it
  const canSeeOvertime = hasPermission(user, "overtime");
  const t = await getT();

  const employees = employeesInScope(viewerScope(user, db.employees), db.employees);
  const formOptions = employeeFormOptions(await loadPayContext());

  // Archived = archived by hand, or terminated a month or more ago (see isArchived). Only the viewer's own
  // scope is looked at, so a department supervisor sees just their department's archive.
  const now = new Date();
  const archivedIds = employees.filter((e) => isArchived(e, now)).map((e) => e.id);

  const incompleteDocIds = employees
    .filter((e) => {
      const missingDocs = missingDocumentTypes(db.employeeDocuments.filter((d) => d.employeeId === e.id), requiredDocumentTypes(e));
      const missingAcks = missingAcknowledgmentKeys(db.employeeAcknowledgments.filter((a) => a.employeeId === e.id), requiredAcknowledgmentKeys(e));
      return missingDocs.length > 0 || missingAcks.length > 0;
    })
    .map((e) => e.id);

  // The personal photo each employee uploaded under Documents (images only — a PDF can't be a thumbnail).
  // `thumb=1` asks the documents route for the small cached copy rather than the full-size upload.
  // Uploads aren't replaced in place, so an employee can have several — take the newest.
  const photoUrls: Record<string, string> = {};
  const newest: Record<string, string> = {};
  for (const d of db.employeeDocuments) {
    if (d.type !== "personal_photo" || !d.mimeType?.startsWith("image/")) continue;
    if (newest[d.employeeId] && newest[d.employeeId] >= d.uploadedAt) continue;
    newest[d.employeeId] = d.uploadedAt;
    photoUrls[d.employeeId] = `${d.fileUrl}&thumb=1`;
  }

  return (
    <div className="flex flex-col gap-6">
      <EmployeesView
        employees={employees}
        archivedIds={archivedIds}
        departments={db.departments}
        shifts={db.shifts}
        incompleteDocIds={incompleteDocIds}
        photoUrls={photoUrls}
        headerActions={
          canEdit || canSeeOvertime ? (
            <>
              {canSeeOvertime && (
                <Button asChild variant="outline" className="gap-2">
                  <Link href="/overtime/statement">
                    <Clock3 className="h-4 w-4" />
                    {t.overtime.statement.button}
                  </Link>
                </Button>
              )}
              {canEdit && <EmployeeFormDialog departments={db.departments} shifts={db.shifts} {...formOptions} />}
            </>
          ) : null
        }
      />
      {canUseAssistant(user) && <EmployeeAssistant />}
    </div>
  );
}
