"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { computeFromActuals } from "@/lib/attendance-engine";
import { recalculateDailyAttendance } from "@/lib/attendance-service";
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

const manualAttendanceSchema = z
  .object({
    employeeId: z.string().min(1),
    date: z.string().min(1),
    workStart: z.string().min(1),
    workEnd: z.string().min(1),
  })
  // same-day entry only, matching the simple in/out fields the modal collects
  .refine((d) => d.workEnd > d.workStart, { path: ["workEnd"], message: "end before start" });

type ManualAttendancePayload = z.infer<typeof manualAttendanceSchema>;

/**
 * Adds a manual "in" and "out" punch for one employee/day and recalculates that day through the exact
 * same pipeline a real fingerprint punch goes through (`recalculateDailyAttendance`): lateness, worked
 * hours and overtime all come out of the existing calculation, not a separate one here. An exact-timestamp
 * duplicate of either punch is skipped, same as a repeated device punch already is.
 */
export async function addManualAttendance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = manualAttendanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const { employeeId, date } = parsed.data;
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.invalidData };

  const actor = await getSession();

  return gate(
    {
      actionKey: "attendance.addManual",
      module: t.nav.attendance,
      actionLabel: t.auditActions.addManualAttendance,
      summary: `${employee.name} (${employeeId}) — ${date} — ${parsed.data.workStart} → ${parsed.data.workEnd}`,
      targetId: employeeId,
    },
    parsed.data,
    () => applyAddManualAttendance(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyAddManualAttendance(payload: ManualAttendancePayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { employeeId, date, workStart, workEnd } = payload;

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.invalidData };

  const inTime = new Date(`${date}T${workStart}:00`);
  const outTime = new Date(`${date}T${workEnd}:00`);

  await recordChangeAs(
    actorName,
    {
      module: t.nav.attendance,
      action: t.auditActions.addManualAttendance,
      newValue: `${employee.name} — ${date} — ${workStart} → ${workEnd}`,
    },
    async (tx) => {
      for (const [timestamp, punchType] of [[inTime, "in"], [outTime, "out"]] as const) {
        const existing = await tx.attendanceLog.findFirst({ where: { employeeId, timestamp }, select: { id: true } });
        if (!existing) {
          await tx.attendanceLog.create({ data: { employeeId, timestamp, punchType, source: "manual_correction" } });
        }
      }
    },
  );

  // Same recomputation every real punch goes through — late/worked/overtime all come from there.
  await recalculateDailyAttendance(employeeId, date);

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath(`/employees/${employee.employeeNumber}`);
  revalidatePath("/audit-log");

  return { success: true, message: t.attendance.manualAttendanceSaved };
}
