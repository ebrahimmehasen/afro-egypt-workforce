"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { ActionState } from "@/hooks/use-action-feedback";
import { refreshPayCalculations } from "@/lib/pay-refresh";

// Pay types, work schedules and the general pay settings. Only the main admin manages them: they decide how
// everyone is paid. Every change is audited and brings the days not yet approved in line with the new rules
// (see refreshPayCalculations); approved and closed pay months never change.

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(TIME);
const optionalTime = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || TIME.test(v));
const bool = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true");
const multiplier = z.coerce.number().min(0).max(100);

async function adminOnly() {
  const t = await getT();
  const user = await getSession();
  if (!user || user.role !== "admin") return { t, user: null, error: t.validation.notAllowed };
  return { t, user, error: null };
}

function afterChange() {
  for (const path of ["/settings", "/employees", "/attendance", "/overtime", "/deductions", "/payroll", "/dashboard"]) revalidatePath(path);
  refreshPayCalculations();
}

// ---------------------------------------------------------------------------------------------------------
// Pay types

const payTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  basis: z.enum(["monthly", "daily"]),
  dayDivisor: z.coerce.number().positive().max(366),
  hoursPerDay: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0 && v <= 24)),
  workStart: optionalTime,
  workEnd: optionalTime,
  overtimeStart: optionalTime,
  graceMinutes: z.coerce.number().min(0).max(240),
  lateMultiplier: multiplier,
  overtimeMultiplier: multiplier,
  overtimeMinimumMinutes: z.coerce.number().int().min(0).max(24 * 60),
  overtimeStepMinutes: z.coerce.number().int().min(1).max(24 * 60),
  overtimeAutoApprove: bool,
  permissionMultiplier: multiplier,
  unauthorizedExitMultiplier: multiplier,
  fridayMultiplier: multiplier,
  holidayMultiplier: multiplier,
  thursdayRuleEnabled: bool,
  thursdayWorkEnd: optionalTime,
  thursdayExtraMultiplier: multiplier,
  permittedAbsenceDays: z.coerce.number().min(0).max(30),
  unpermittedAbsenceDays: z.coerce.number().min(0).max(30),
  leaveNoticeHours: z.coerce.number().int().min(0).max(24 * 30),
  active: bool,
});

export async function savePayType(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const parsed = payTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const { id, ...data } = parsed.data;
  if (data.thursdayRuleEnabled && !data.thursdayWorkEnd) return { error: t.paySettings.thursdayEndRequired, fields: ["thursdayWorkEnd"] };

  const before = id ? await prisma.payType.findUnique({ where: { id } }) : null;
  if (id && !before) return { error: t.validation.notFound };

  await recordChangeAs(
    user.name,
    {
      module: t.nav.settings,
      action: id ? t.auditActions.editPayType : t.auditActions.addPayType,
      oldValue: before ? summarize(before) : undefined,
      newValue: summarize(data),
    },
    (tx) => (id ? tx.payType.update({ where: { id }, data }) : tx.payType.create({ data })),
  );
  afterChange();
  return { success: true, message: t.paySettings.saved };
}

const RULE_FIELDS = [
  "lateMultiplier",
  "overtimeMultiplier",
  "overtimeMinimumMinutes",
  "overtimeStepMinutes",
  "permissionMultiplier",
  "unauthorizedExitMultiplier",
  "fridayMultiplier",
  "holidayMultiplier",
  "thursdayExtraMultiplier",
  "graceMinutes",
  "dayDivisor",
  "permittedAbsenceDays",
  "unpermittedAbsenceDays",
  "leaveNoticeHours",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

const INTEGER_FIELDS: RuleField[] = ["overtimeMinimumMinutes", "overtimeStepMinutes", "leaveNoticeHours"];

/** Changes one rule of one pay type — the "Edit" next to each rule on the settings page. */
export async function updatePayTypeRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "") as RuleField;
  const value = Number(formData.get("value"));
  if (!RULE_FIELDS.includes(field) || !Number.isFinite(value) || value < 0) return { error: t.validation.invalidData };
  if ((field === "overtimeStepMinutes" || field === "dayDivisor") && value <= 0) return { error: t.validation.invalidData };
  const stored = INTEGER_FIELDS.includes(field) ? Math.round(value) : value;

  const before = await prisma.payType.findUnique({ where: { id } });
  if (!before) return { error: t.validation.notFound };
  await recordChangeAs(
    user.name,
    {
      module: t.nav.settings,
      action: t.auditActions.editPayRule,
      oldValue: `${before.name} — ${field}: ${before[field]}`,
      newValue: `${before.name} — ${field}: ${stored}`,
    },
    (tx) => tx.payType.update({ where: { id }, data: { [field]: stored } }),
  );
  afterChange();
  return { success: true, message: t.paySettings.saved };
}

/**
 * Removes a pay type. The two built-in types can't be removed (older records resolve to them). One that any
 * employee is on — now or in the past — is only retired (hidden, kept for history); an unused one is deleted.
 */
export async function deletePayType(id: string): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const payType = await prisma.payType.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
  if (!payType) return { error: t.validation.notFound };
  if (payType.code) return { error: t.paySettings.builtInCantDelete };

  const inUse = payType._count.employees > 0;
  await recordChangeAs(
    user.name,
    { module: t.nav.settings, action: t.auditActions.deletePayType, oldValue: payType.name, newValue: inUse ? t.paySettings.retired : "-" },
    (tx) =>
      inUse
        ? tx.payType.update({ where: { id }, data: { deletedAt: new Date(), active: false } })
        : tx.payType.delete({ where: { id } }),
  );
  afterChange();
  return { success: true, message: inUse ? t.paySettings.retiredInUse : t.paySettings.deleted };
}

function summarize(p: { name: string; dayDivisor: number; lateMultiplier: number; overtimeMultiplier: number; fridayMultiplier: number; holidayMultiplier: number }) {
  return `${p.name} — ÷${p.dayDivisor}, late ×${p.lateMultiplier}, OT ×${p.overtimeMultiplier}, Fri ×${p.fridayMultiplier}, hol ×${p.holidayMultiplier}`;
}

// ---------------------------------------------------------------------------------------------------------
// Work schedules

const scheduleSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().max(100).optional(),
  startTime: time,
  endTime: time,
  overtimeStart: optionalTime,
  active: bool,
});

export async function saveWorkSchedule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const { id, ...rest } = parsed.data;
  const data = { ...rest, name: rest.name || `${rest.startTime} → ${rest.endTime}` };

  const before = id ? await prisma.workSchedule.findUnique({ where: { id } }) : null;
  if (id && !before) return { error: t.validation.notFound };
  const sortOrder = id ? undefined : ((await prisma.workSchedule.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 1;

  await recordChangeAs(
    user.name,
    {
      module: t.nav.settings,
      action: id ? t.auditActions.editWorkSchedule : t.auditActions.addWorkSchedule,
      oldValue: before ? `${before.name} (${before.startTime} → ${before.endTime})` : undefined,
      newValue: `${data.name} (${data.startTime} → ${data.endTime})`,
    },
    (tx) => (id ? tx.workSchedule.update({ where: { id }, data }) : tx.workSchedule.create({ data: { ...data, sortOrder: sortOrder ?? 0 } })),
  );
  afterChange();
  return { success: true, message: t.paySettings.saved };
}

/** Removes a schedule: retired (hidden, kept) if any employee is on it, deleted otherwise. */
export async function deleteWorkSchedule(id: string): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const schedule = await prisma.workSchedule.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
  if (!schedule) return { error: t.validation.notFound };
  const inUse = schedule._count.employees > 0;
  await recordChangeAs(
    user.name,
    { module: t.nav.settings, action: t.auditActions.deleteWorkSchedule, oldValue: schedule.name, newValue: inUse ? t.paySettings.retired : "-" },
    (tx) =>
      inUse
        ? tx.workSchedule.update({ where: { id }, data: { deletedAt: new Date(), active: false } })
        : tx.workSchedule.delete({ where: { id } }),
  );
  afterChange();
  return { success: true, message: inUse ? t.paySettings.retiredInUse : t.paySettings.deleted };
}

// ---------------------------------------------------------------------------------------------------------
// General

const generalSchema = z.object({
  weeklyOffDays: z.array(z.coerce.number().int().min(0).max(6)).max(6),
  payPeriodStartDay: z.coerce.number().int().min(1).max(28),
});

export async function saveGeneralPaySettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user, error } = await adminOnly();
  if (error || !user) return { error };
  const parsed = generalSchema.safeParse({
    weeklyOffDays: formData.getAll("weeklyOffDays").map(String),
    payPeriodStartDay: formData.get("payPeriodStartDay"),
  });
  if (!parsed.success) return { error: t.validation.invalidData };
  const weeklyOffDays = [...new Set(parsed.data.weeklyOffDays)].sort().join(",");

  const [attendance, payroll] = await Promise.all([
    prisma.attendanceSettings.findUnique({ where: { id: "singleton" } }),
    prisma.payrollSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  await recordChangeAs(
    user.name,
    {
      module: t.nav.settings,
      action: t.auditActions.editGeneralPaySettings,
      oldValue: `off: ${attendance?.weeklyOffDays ?? "-"}, start: ${payroll?.payPeriodStartDay ?? "-"}`,
      newValue: `off: ${weeklyOffDays}, start: ${parsed.data.payPeriodStartDay}`,
    },
    async (tx) => {
      await tx.attendanceSettings.upsert({ where: { id: "singleton" }, update: { weeklyOffDays }, create: { id: "singleton", weeklyOffDays } });
      await tx.payrollSettings.upsert({
        where: { id: "singleton" },
        update: { payPeriodStartDay: parsed.data.payPeriodStartDay },
        create: { id: "singleton", payPeriodStartDay: parsed.data.payPeriodStartDay },
      });
    },
  );
  afterChange();
  return { success: true, message: t.paySettings.saved };
}
