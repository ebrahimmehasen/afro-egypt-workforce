"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

const SINGLETON = "singleton";

const companySchema = z.object({
  companyName: z.string().min(2),
  address: z.string().min(2),
  phone: z.string().min(3),
});

export async function updateCompanySettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  await prisma.companySettings.upsert({
    where: { id: SINGLETON },
    update: parsed.data,
    create: { id: SINGLETON, logoUrl: "/brand/afro-egypt-logo.jpg", ...parsed.data },
  });
  revalidatePath("/settings");
  return { success: true, message: t.settings.savedCompany };
}

const attendanceSchema = z.object({
  defaultGracePeriodMinutes: z.coerce.number().min(0),
  lateDeductionPerMinute: z.coerce.number().min(0),
  earlyLeaveDeductionPerMinute: z.coerce.number().min(0),
  absenceDeductionDays: z.coerce.number().min(0),
});

export async function updateAttendanceSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = attendanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const user = await getSession();
  await prisma.attendanceSettings.upsert({
    where: { id: SINGLETON },
    update: parsed.data,
    create: { id: SINGLETON, ...parsed.data },
  });
  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.editAttendanceSettings,
    module: t.nav.settings,
    oldValue: "-",
    newValue: `${t.settings.defaultGrace}: ${parsed.data.defaultGracePeriodMinutes}`,
  });
  revalidatePath("/settings");
  return { success: true, message: t.settings.savedAttendance };
}

const payrollSchema = z.object({
  overtimeHourlyMultiplier: z.coerce.number().positive(),
  workingDaysPerMonth: z.coerce.number().positive(),
  workingHoursPerDay: z.coerce.number().positive(),
});

export async function updatePayrollSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = payrollSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const user = await getSession();
  await prisma.payrollSettings.upsert({
    where: { id: SINGLETON },
    update: parsed.data,
    create: { id: SINGLETON, ...parsed.data },
  });
  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.editPayrollSettings,
    module: t.nav.settings,
    oldValue: "-",
    newValue: `${t.settings.overtimeMultiplier}: ${parsed.data.overtimeHourlyMultiplier}`,
  });
  revalidatePath("/settings");
  return { success: true, message: t.settings.savedPayroll };
}
