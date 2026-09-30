"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canManageEmployeeFiles } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import {
  canAcknowledgmentBeRequired,
  defaultRequiredAcknowledgmentKeys,
  parseRequiredAcknowledgments,
  requiredAcknowledgmentKeys,
  withAcknowledgmentRequirement,
} from "@/lib/acknowledgments";
import { StandardAcknowledgmentKey } from "@/lib/types";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

/** Moves one acknowledgment slot between this employee's "required" and "additional" lists. */
export async function setAcknowledgmentRequired(
  employeeId: string,
  key: string,
  required: boolean,
): Promise<ActionState> {
  const t = await getT();
  const user = await getSession();
  if (!user || !canManageEmployeeFiles(user)) return { error: t.validation.invalidData };
  if (!canAcknowledgmentBeRequired(key)) return { error: t.validation.invalidData };
  if (!(await canViewEmployee(user, employeeId))) return { error: t.validation.employeeNotFound };

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  const typedKey = key as StandardAcknowledgmentKey;
  const current = requiredAcknowledgmentKeys({
    isDriver: employee.isDriver,
    requiredAcknowledgments: parseRequiredAcknowledgments(employee.requiredAcknowledgments),
  });
  if (current.includes(typedKey) === required) return { success: true, message: t.documents.requirementSaved };

  const next = withAcknowledgmentRequirement(current, typedKey, required, defaultRequiredAcknowledgmentKeys(employee));

  await recordChange(
    {
      module: t.nav.employees,
      action: t.documents.auditRequirement,
      newValue: `${t.acknowledgments.slots[typedKey]} — ${required ? t.documents.requiredLabel : t.documents.optionalLabel}`,
      reason: `${employee.name} (${employee.employeeNumber})`,
    },
    (tx) =>
      tx.employee.update({
        where: { id: employeeId },
        data: { requiredAcknowledgments: next ?? Prisma.DbNull },
      }),
  );

  revalidatePath(`/employees/${employee.employeeNumber}`);
  revalidatePath("/employees");
  return { success: true, message: t.documents.requirementSaved };
}
