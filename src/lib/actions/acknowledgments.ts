"use server";

import { revalidatePath } from "next/cache";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canCorrectAttendance } from "@/lib/permissions";
import { recordChange } from "@/lib/audit";
import { ACKNOWLEDGMENT_BODY, acknowledgmentTypeLabel } from "@/lib/acknowledgments";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

const genSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["employment_terms", "custody_receipt", "confidentiality", "code_of_conduct", "other"]),
  customText: z.string().optional(),
});

/** Generates an acknowledgment row (ready to print, sign on paper, then upload the scan). */
export async function generateAcknowledgment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const user = await getSession();
  if (!user || !canCorrectAttendance(user.role)) return { error: t.validation.invalidData };

  const parsed = genSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { employeeId, type, customText } = parsed.data;

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  const body = type === "other" ? (customText ?? "").trim() : ACKNOWLEDGMENT_BODY[type];
  if (!body) return { error: t.validation.invalidData };

  await recordChange(
    {
      module: t.nav.employees,
      action: t.acknowledgments.auditGenerate,
      newValue: `${acknowledgmentTypeLabel(type, t)} — ${employee.name}`,
      reason: employeeId,
    },
    (tx) =>
      tx.employeeAcknowledgment.create({
        data: { employeeId, type, title: body, createdBy: user.name },
      }),
  );

  revalidatePath(`/employees/${employeeId}`);
  return { success: true, message: t.acknowledgments.generated };
}

export async function deleteAcknowledgment(id: string) {
  const t = await getT();
  const user = await getSession();
  if (!user || !canCorrectAttendance(user.role)) return { error: t.validation.invalidData };

  const ack = await prisma.employeeAcknowledgment.findUnique({ where: { id } });
  if (!ack) return { error: t.validation.notFound };

  await recordChange(
    {
      module: t.nav.employees,
      action: t.acknowledgments.auditDelete,
      oldValue: `${acknowledgmentTypeLabel(ack.type, t)} — ${ack.employeeId}`,
      reason: ack.employeeId,
    },
    (tx) => tx.employeeAcknowledgment.delete({ where: { id } }),
  );

  if (ack.fileUrl) {
    await unlink(path.join(process.cwd(), "public", ack.fileUrl)).catch(() => {});
  }
  revalidatePath(`/employees/${ack.employeeId}`);
  return { success: true };
}
