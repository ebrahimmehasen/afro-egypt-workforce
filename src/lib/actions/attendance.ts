"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
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
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  const device = await prisma.device.findUnique({ where: { id: deviceId } });

  await prisma.attendanceLog.create({
    data: {
      employeeId,
      deviceId: device ? deviceId : null,
      timestamp: new Date(`${date}T${time}:00`),
      punchType,
      source: "simulated",
    },
  });

  await recalculateDailyAttendance(employeeId, date);
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
  const user = await getSession();
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  const shift = employee ? await prisma.shift.findUnique({ where: { id: employee.shiftId } }) : null;
  if (!employee || !shift) return { error: t.validation.invalidData };

  const dateOnly = new Date(`${date}T00:00:00.000Z`);
  const before = await prisma.dailyAttendance.findUnique({
    where: { employeeId_date: { employeeId, date: dateOnly } },
  });
  if (!before) return { error: t.validation.noAttendanceRecordForDay };

  const shiftForEngine = {
    id: shift.id,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    gracePeriodMinutes: shift.gracePeriodMinutes,
    workDays: (shift.workDays as number[]) ?? [],
    allowOvertime: shift.allowOvertime,
  };
  const newIn = correctedIn ? new Date(`${date}T${correctedIn}:00`) : before.actualIn;
  const newOut = correctedOut ? new Date(`${date}T${correctedOut}:00`) : before.actualOut;

  const computed = computeFromActuals(
    before.scheduledStart,
    before.scheduledEnd,
    shiftForEngine,
    newIn,
    newOut,
  );

  await prisma.dailyAttendance.update({
    where: { employeeId_date: { employeeId, date: dateOnly } },
    data: {
      actualIn: computed.actualIn,
      actualOut: computed.actualOut,
      lateMinutes: computed.lateMinutes,
      deductibleLateMinutes: computed.deductibleLateMinutes,
      earlyLeaveMinutes: computed.earlyLeaveMinutes,
      workedMinutes: computed.workedMinutes,
      overtimeMinutes: computed.overtimeMinutes,
      status: computed.status,
      correctionReason: reason,
      correctedBy: user?.name ?? t.auditActions.system,
      correctedAt: new Date(),
    },
  });

  const timeFmt = (d: Date | null) =>
    d ? d.toLocaleTimeString(locale === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—";

  await addAuditLog({
    userName: user?.name ?? t.auditActions.system,
    action: t.auditActions.correctAttendance,
    module: t.nav.attendance,
    oldValue: `${t.attendance.colOut}: ${timeFmt(before.actualOut)}`,
    newValue: `${t.attendance.colOut}: ${timeFmt(computed.actualOut)}`,
    reason,
  });

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/audit-log");

  return { success: true, message: t.attendance.correctionSaved };
}
