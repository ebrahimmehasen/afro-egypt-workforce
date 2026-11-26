"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { hasPermission, isSelfService } from "@/lib/permissions";
import { canViewEmployee } from "@/lib/scope";
import { gate } from "@/lib/change-requests";
import { nextId } from "@/lib/id";
import { datesInRange, recalculateRange } from "@/lib/attendance-service";
import { scheduleAttendanceEffects } from "@/lib/attendance-effects";
import { lockedDayCheck } from "@/lib/attendance-deductions";
import { loadPayContext } from "@/lib/pay-context";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { dayStr } from "@/lib/serialize";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const optionalTime = z.union([z.literal(""), z.string().regex(timeRe)]).optional().default("");

const missionSchema = z.object({
  employeeId: z.string().min(1),
  destination: z.string().trim().min(1).max(200),
  from: z.string().min(1),
  to: z.string().min(1),
  startTime: optionalTime,
  endTime: optionalTime,
  confirmedEnd: optionalTime,
  durationMinutes: z.union([z.literal(""), z.coerce.number().int().min(1).max(24 * 60)]).optional().default(""),
  reason: z.string().trim().max(2000).optional().default(""),
});

const dayDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Admin, or an "اداري" account holding "missions" for an employee it can see. Self-service accounts never file one. */
async function canFileMission(employeeId: string) {
  const actor = await getSession();
  if (!actor) return null;
  if (actor.role !== "admin" && (isSelfService(actor) || !hasPermission(actor, "missions"))) return null;
  if (!(await canViewEmployee(actor, employeeId))) return null;
  return actor;
}

/** A day inside a closed pay period never changes — the same rule every other attendance-affecting entry follows. */
async function lockedRangeError(t: Awaited<ReturnType<typeof getT>>, from: string, to: string): Promise<string | null> {
  const [ctx, periods] = await Promise.all([loadPayContext(), prisma.payrollPeriod.findMany({ where: { status: "closed" } })]);
  const isLocked = lockedDayCheck(periods, ctx);
  return datesInRange(from, to).some((d) => isLocked(d)) ? t.missions.errLockedPeriod : null;
}

export async function createMission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = missionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { employeeId, destination, startTime, endTime, confirmedEnd, durationMinutes, reason } = parsed.data;
  const timed = Boolean(startTime);
  const to = timed ? parsed.data.from : parsed.data.to;
  if (parsed.data.from > to) return { error: t.missions.errInvalidTimes };
  if (timed && endTime && startTime >= endTime) return { error: t.missions.errInvalidTimes };

  const actor = await canFileMission(employeeId);
  if (!actor) return { error: t.validation.notAllowed };

  const lockedError = await lockedRangeError(t, parsed.data.from, to);
  if (lockedError) return { error: lockedError };

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  const id = nextId("MS");
  return gate(
    {
      actionKey: "missions.create",
      module: t.nav.missions,
      actionLabel: t.auditActions.addMission,
      summary: `${employee.employeeNumber} — ${destination}`,
    },
    { id, employeeId, destination, from: parsed.data.from, to, startTime: timed ? startTime : "", endTime: timed ? endTime : "", confirmedEnd, durationMinutes, reason },
    () =>
      applyCreateMission(
        { id, employeeId, destination, from: parsed.data.from, to, startTime: timed ? startTime : "", endTime: timed ? endTime : "", confirmedEnd, durationMinutes, reason },
        actor.name,
      ),
  );
}

type CreateMissionPayload = {
  id: string;
  employeeId: string;
  destination: string;
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  confirmedEnd: string;
  durationMinutes: number | "";
  reason: string;
};

export async function applyCreateMission(payload: CreateMissionPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const employee = await prisma.employee.findFirst({ where: { id: payload.employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.missions,
      action: t.auditActions.addMission,
      newValue: `${employee.employeeNumber} — ${payload.destination} — ${payload.from} → ${payload.to}`,
      reason: payload.reason,
    },
    (tx) =>
      tx.mission.create({
        data: {
          id: payload.id,
          employeeId: payload.employeeId,
          destination: payload.destination,
          from: dayDate(payload.from),
          to: dayDate(payload.to),
          startTime: payload.startTime || null,
          endTime: payload.endTime || null,
          confirmedEnd: payload.confirmedEnd || null,
          durationMinutes: payload.durationMinutes === "" ? null : payload.durationMinutes,
          reason: payload.reason || null,
          status: "approved",
          approvedBy: actorName,
          createdBy: actorName,
        },
      }),
  );

  await recalculateRange(payload.employeeId, payload.from, payload.to);
  revalidatePath("/missions");
  revalidatePath("/attendance");
  revalidatePath("/overtime");
  revalidatePath("/dashboard");
  revalidatePath("/audit-log");
  scheduleAttendanceEffects({ payrollChanged: true });
  return { success: true, message: t.missions.submitted };
}

const updateMissionSchema = missionSchema.extend({ id: z.string().min(1) });
type UpdateMissionPayload = z.infer<typeof updateMissionSchema>;

export async function updateMission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = updateMissionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const existing = await prisma.mission.findUnique({ where: { id: parsed.data.id }, include: { employee: true } });
  if (!existing) return { error: t.validation.requestNotFound };

  const timed = Boolean(parsed.data.startTime);
  const to = timed ? parsed.data.from : parsed.data.to;
  if (parsed.data.from > to) return { error: t.missions.errInvalidTimes };
  if (timed && parsed.data.endTime && parsed.data.startTime >= parsed.data.endTime) return { error: t.missions.errInvalidTimes };

  const actor = await canFileMission(existing.employeeId);
  if (!actor) return { error: t.validation.notAllowed };

  // either range changed (old or new) can touch days whose pay has already closed
  const lockedError =
    (await lockedRangeError(t, dayStr(existing.from), dayStr(existing.to))) ?? (await lockedRangeError(t, parsed.data.from, to));
  if (lockedError) return { error: lockedError };

  const payload: UpdateMissionPayload = { ...parsed.data, to, startTime: timed ? parsed.data.startTime : "", endTime: timed ? parsed.data.endTime : "" };
  return gate(
    {
      actionKey: "missions.update",
      module: t.nav.missions,
      actionLabel: t.auditActions.editMission,
      summary: `${existing.employee.employeeNumber} — ${payload.destination}`,
      targetId: existing.id,
    },
    payload,
    () => applyUpdateMission(payload, actor.name),
  );
}

export async function applyUpdateMission(payload: UpdateMissionPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.mission.findUnique({ where: { id: payload.id }, include: { employee: true } });
  if (!existing) return { error: t.validation.requestNotFound };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.missions,
      action: t.auditActions.editMission,
      oldValue: `${existing.destination} — ${dayStr(existing.from)} → ${dayStr(existing.to)}`,
      newValue: `${payload.destination} — ${payload.from} → ${payload.to}`,
      reason: payload.reason,
    },
    (tx) =>
      tx.mission.update({
        where: { id: payload.id },
        data: {
          destination: payload.destination,
          from: dayDate(payload.from),
          to: dayDate(payload.to),
          startTime: payload.startTime || null,
          endTime: payload.endTime || null,
          confirmedEnd: payload.confirmedEnd || null,
          durationMinutes: payload.durationMinutes === "" ? null : payload.durationMinutes,
          reason: payload.reason || null,
        },
      }),
  );

  // recompute both the old and the new span, so a day dropped from the mission goes back to normal
  const fromDay = [dayStr(existing.from), payload.from].sort()[0];
  const toDay = [dayStr(existing.to), payload.to].sort().at(-1)!;
  await recalculateRange(existing.employeeId, fromDay, toDay);
  revalidatePath("/missions");
  revalidatePath("/attendance");
  revalidatePath("/overtime");
  revalidatePath("/dashboard");
  revalidatePath("/audit-log");
  scheduleAttendanceEffects({ payrollChanged: true });
  return { success: true, message: t.missions.updated };
}

export async function deleteMission(id: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.mission.findUnique({ where: { id }, include: { employee: true } });
  if (!existing) return { error: t.validation.requestNotFound };
  const actor = await canFileMission(existing.employeeId);
  if (!actor) return { error: t.validation.notAllowed };

  const lockedError = await lockedRangeError(t, dayStr(existing.from), dayStr(existing.to));
  if (lockedError) return { error: lockedError };

  return gate(
    {
      actionKey: "missions.delete",
      module: t.nav.missions,
      actionLabel: t.auditActions.deleteMission,
      summary: `${existing.employee.employeeNumber} — ${existing.destination}`,
      targetId: id,
    },
    { id },
    () => applyDeleteMission({ id }, actor.name),
  );
}

export async function applyDeleteMission(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const existing = await prisma.mission.findUnique({ where: { id: payload.id } });
  if (!existing) return { error: t.validation.requestNotFound };

  const from = dayStr(existing.from);
  const to = dayStr(existing.to);
  await recordChangeAs(
    actorName,
    { module: t.nav.missions, action: t.auditActions.deleteMission, oldValue: `${existing.destination} — ${from} → ${to}` },
    (tx) => tx.mission.delete({ where: { id: payload.id } }),
  );

  await recalculateRange(existing.employeeId, from, to);
  revalidatePath("/missions");
  revalidatePath("/attendance");
  revalidatePath("/overtime");
  revalidatePath("/dashboard");
  revalidatePath("/audit-log");
  scheduleAttendanceEffects({ payrollChanged: true });
  return { success: true, message: t.missions.deleted };
}
