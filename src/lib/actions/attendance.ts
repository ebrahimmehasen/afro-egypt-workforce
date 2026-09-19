"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { computeFromActuals } from "@/lib/attendance-engine";
import { toShift } from "@/lib/serialize";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT, intlLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";

const correctionSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  correctedIn: z.string().optional(),
  correctedOut: z.string().optional(),
  reason: z.string().min(3),
});

type CorrectionPayload = z.infer<typeof correctionSchema>;

export async function correctAttendance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const locale = await getLocale();
  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const { employeeId, date, correctedOut } = parsed.data;
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.invalidData };

  const dateOnly = new Date(`${date}T00:00:00.000Z`);
  const before = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId, date: dateOnly } } });
  if (!before) return { error: t.validation.noAttendanceRecordForDay };

  const timeFmt = (d: Date | null) =>
    d ? d.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }) : "—";
  const newOut = correctedOut ? new Date(`${date}T${correctedOut}:00`) : before.actualOut;

  const actor = await getSession();

  return gate(
    {
      actionKey: "attendance.correct",
      module: t.nav.attendance,
      actionLabel: t.auditActions.correctAttendance,
      summary: `${employee.name} (${employeeId}) — ${date} — ${t.attendance.colOut}: ${timeFmt(before.actualOut)} → ${timeFmt(newOut)}`,
      targetId: employeeId,
    },
    parsed.data,
    () => applyCorrectAttendance(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCorrectAttendance(payload: CorrectionPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const locale = await getLocale();
  const { employeeId, date, correctedIn, correctedOut, reason } = payload;

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  const shift = employee ? await prisma.shift.findUnique({ where: { id: employee.shiftId } }) : null;
  if (!employee || !shift) return { error: t.validation.invalidData };

  const dateOnly = new Date(`${date}T00:00:00.000Z`);
  const before = await prisma.dailyAttendance.findUnique({
    where: { employeeId_date: { employeeId, date: dateOnly } },
  });
  if (!before) return { error: t.validation.noAttendanceRecordForDay };

  const shiftForEngine = toShift(shift);
  const newIn = correctedIn ? new Date(`${date}T${correctedIn}:00`) : before.actualIn;
  const newOut = correctedOut ? new Date(`${date}T${correctedOut}:00`) : before.actualOut;

  const computed = computeFromActuals(before.scheduledStart, before.scheduledEnd, shiftForEngine, newIn, newOut);

  const timeFmt = (d: Date | null) =>
    d ? d.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }) : "—";

  await recordChangeAs(
    actorName,
    {
      module: t.nav.attendance,
      action: t.auditActions.correctAttendance,
      oldValue: `${t.attendance.colOut}: ${timeFmt(before.actualOut)}`,
      newValue: `${t.attendance.colOut}: ${timeFmt(computed.actualOut)}`,
      reason,
    },
    (tx) =>
      tx.dailyAttendance.update({
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
          correctedBy: actorName,
          correctedAt: new Date(),
        },
      }),
  );

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath(`/employees/${employee.employeeNumber}`);
  revalidatePath("/audit-log");

  return { success: true, message: t.attendance.correctionSaved };
}
