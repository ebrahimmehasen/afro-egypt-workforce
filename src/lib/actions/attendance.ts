"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/data";
import { addAuditLog } from "@/lib/store";
import { getSession } from "@/lib/auth";
import { recalculateDailyAttendance } from "@/lib/attendance-service";
import { computeFromActuals } from "@/lib/attendance-engine";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";

const punchSchema = z.object({
  employeeId: z.string().min(1),
  punchType: z.enum(["in", "out"]),
  date: z.string().min(1),
  time: z.string().min(1),
  deviceId: z.string().min(1),
});

export async function simulatePunch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = punchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const { employeeId, punchType, date, time, deviceId } = parsed.data;
  const db = getDb();
  const employee = db.employees.find((e) => e.id === employeeId);
  if (!employee) return { error: t.validation.employeeNotFound };

  db.attendanceLogs.push({
    id: `LOG-${db.attendanceLogs.length + 1}`,
    employeeId,
    deviceId,
    timestamp: `${date}T${time}:00`,
    punchType,
    source: "simulated",
  });

  recalculateDailyAttendance(employeeId, date);
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath(`/employees/${employeeId}`);

  return { success: true, message: t.attendance.punchSuccess };
}

const correctionSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  correctedIn: z.string().optional(),
  correctedOut: z.string().optional(),
  reason: z.string().min(3),
});

export async function correctAttendance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const locale = await getLocale();
  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const { employeeId, date, correctedIn, correctedOut, reason } = parsed.data;
  const db = getDb();
  const user = await getSession();
  const employee = db.employees.find((e) => e.id === employeeId);
  const shift = db.shifts.find((s) => s.id === employee?.shiftId);
  if (!employee || !shift) return { error: t.validation.invalidData };

  const idx = db.dailyAttendance.findIndex((a) => a.employeeId === employeeId && a.date === date);
  if (idx === -1) return { error: t.validation.noAttendanceRecordForDay };

  const before = db.dailyAttendance[idx];
  const scheduledStart = new Date(before.scheduledStart);
  const scheduledEnd = new Date(before.scheduledEnd);
  const newIn = correctedIn ? new Date(`${date}T${correctedIn}:00`) : before.actualIn ? new Date(before.actualIn) : null;
  const newOut = correctedOut ? new Date(`${date}T${correctedOut}:00`) : before.actualOut ? new Date(before.actualOut) : null;

  const computed = computeFromActuals(scheduledStart, scheduledEnd, shift, newIn, newOut);

  db.dailyAttendance[idx] = {
    ...before,
    actualIn: computed.actualIn?.toISOString() ?? null,
    actualOut: computed.actualOut?.toISOString() ?? null,
    lateMinutes: computed.lateMinutes,
    deductibleLateMinutes: computed.deductibleLateMinutes,
    earlyLeaveMinutes: computed.earlyLeaveMinutes,
    workedMinutes: computed.workedMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status: computed.status,
    correctionReason: reason,
    correctedBy: user?.name ?? t.auditActions.system,
    correctedAt: new Date().toISOString(),
  };

  const timeFmt = (d: Date | null) =>
    d ? d.toLocaleTimeString(locale === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—";

  addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.correctAttendance,
    module: t.nav.attendance,
    oldValue: `${t.attendance.colOut}: ${timeFmt(before.actualOut ? new Date(before.actualOut) : null)}`,
    newValue: `${t.attendance.colOut}: ${timeFmt(computed.actualOut)}`,
    reason,
  });

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/audit-log");

  return { success: true, message: t.attendance.correctionSaved };
}
