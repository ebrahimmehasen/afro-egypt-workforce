"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canManageEmployeeFiles } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { canBeRequired, parseRequiredDocuments, requiredDocumentTypes, withRequirement } from "@/lib/documents";
import { EMPLOYEE_DOCUMENT_TYPES, EmployeeDocumentType } from "@/lib/types";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

/** Moves one document type between this employee's "required" and "additional" lists. */
export async function setDocumentRequired(
  employeeId: string,
  type: EmployeeDocumentType,
  required: boolean,
): Promise<ActionState> {
  const t = await getT();
  const user = await getSession();
  if (!user || !canManageEmployeeFiles(user)) return { error: t.validation.invalidData };
  if (!EMPLOYEE_DOCUMENT_TYPES.includes(type) || !canBeRequired(type)) return { error: t.validation.invalidData };
  if (!(await canViewEmployee(user, employeeId))) return { error: t.validation.employeeNotFound };

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  const current = requiredDocumentTypes({ requiredDocuments: parseRequiredDocuments(employee.requiredDocuments) });
  if (current.includes(type) === required) return { success: true, message: t.documents.requirementSaved };

  const next = withRequirement(current, type, required);

  await recordChange(
    {
      module: t.nav.employees,
      action: t.documents.auditRequirement,
      newValue: `${t.documents.types[type]} — ${required ? t.documents.requiredLabel : t.documents.optionalLabel}`,
      reason: `${employee.name} (${employee.employeeNumber})`,
    },
    (tx) =>
      tx.employee.update({
        where: { id: employeeId },
        data: { requiredDocuments: next ?? Prisma.DbNull },
      }),
  );

  revalidatePath(`/employees/${employee.employeeNumber}`);
  revalidatePath("/employees");
  return { success: true, message: t.documents.requirementSaved };
}
