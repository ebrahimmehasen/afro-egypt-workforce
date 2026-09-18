"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";

const SINGLETON = "singleton";

const companySchema = z.object({
  companyName: z.string().min(2),
  address: z.string().min(2),
  phone: z.string().min(3),
});

type CompanyPayload = z.infer<typeof companySchema>;

export async function updateCompanySettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const actor = await getSession();

  return gate(
    {
      actionKey: "settings.company",
      module: t.nav.settings,
      actionLabel: t.auditActions.editCompanySettings,
      summary: parsed.data.companyName,
    },
    parsed.data,
    () => applyUpdateCompanySettings(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyUpdateCompanySettings(payload: CompanyPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  await recordChangeAs(
    actorName,
    { module: t.nav.settings, action: t.auditActions.editCompanySettings, newValue: payload.companyName },
    (tx) =>
      tx.companySettings.upsert({
        where: { id: SINGLETON },
        update: payload,
        create: { id: SINGLETON, logoUrl: "/brand/afro-egypt-logo.jpg", ...payload },
      }),
  );
  revalidatePath("/settings");
  return { success: true, message: t.settings.savedCompany };
}

const attendanceSchema = z.object({
  defaultGracePeriodMinutes: z.coerce.number().min(0),
  lateDeductionPerMinute: z.coerce.number().min(0),
  earlyLeaveDeductionPerMinute: z.coerce.number().min(0),
  absenceDeductionDays: z.coerce.number().min(0),
});

type AttendanceSettingsPayload = z.infer<typeof attendanceSchema>;

export async function updateAttendanceSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = attendanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const actor = await getSession();

  return gate(
    {
      actionKey: "settings.attendance",
      module: t.nav.settings,
      actionLabel: t.auditActions.editAttendanceSettings,
      summary: `${t.settings.defaultGrace}: ${parsed.data.defaultGracePeriodMinutes}`,
    },
    parsed.data,
    () => applyUpdateAttendanceSettings(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyUpdateAttendanceSettings(payload: AttendanceSettingsPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  await recordChangeAs(
    actorName,
    {
      module: t.nav.settings,
      action: t.auditActions.editAttendanceSettings,
      newValue: `${t.settings.defaultGrace}: ${payload.defaultGracePeriodMinutes}`,
    },
    (tx) => tx.attendanceSettings.upsert({ where: { id: SINGLETON }, update: payload, create: { id: SINGLETON, ...payload } }),
  );
  revalidatePath("/settings");
  return { success: true, message: t.settings.savedAttendance };
}

const payrollSchema = z.object({
  overtimeHourlyMultiplier: z.coerce.number().positive(),
  workingDaysPerMonth: z.coerce.number().positive(),
  workingHoursPerDay: z.coerce.number().positive(),
});

type PayrollSettingsPayload = z.infer<typeof payrollSchema>;

export async function updatePayrollSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = payrollSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const actor = await getSession();

  return gate(
    {
      actionKey: "settings.payroll",
      module: t.nav.settings,
      actionLabel: t.auditActions.editPayrollSettings,
      summary: `${t.settings.overtimeMultiplier}: ${parsed.data.overtimeHourlyMultiplier}`,
    },
    parsed.data,
    () => applyUpdatePayrollSettings(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyUpdatePayrollSettings(payload: PayrollSettingsPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  await recordChangeAs(
    actorName,
    {
      module: t.nav.settings,
      action: t.auditActions.editPayrollSettings,
      newValue: `${t.settings.overtimeMultiplier}: ${payload.overtimeHourlyMultiplier}`,
    },
    (tx) => tx.payrollSettings.upsert({ where: { id: SINGLETON }, update: payload, create: { id: SINGLETON, ...payload } }),
  );
  revalidatePath("/settings");
  return { success: true, message: t.settings.savedPayroll };
}
