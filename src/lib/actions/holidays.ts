"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChangeAs } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { hasPermission } from "@/lib/permissions";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { refreshPayCalculations } from "@/lib/pay-refresh";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A holiday longer than this is almost certainly a typo in the dates. */
const MAX_DAYS = 31;

const holidaySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    from: z.string().regex(DAY),
    to: z.string().regex(DAY).optional().or(z.literal("")),
  })
  .transform((h) => ({ name: h.name, from: h.from, to: h.to || h.from }));

type HolidayPayload = z.infer<typeof holidaySchema>;

const dateOnly = (day: string) => new Date(`${day}T00:00:00.000Z`);
const daysBetween = (from: string, to: string) => Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000) + 1;

function revalidateAttendance() {
  for (const path of ["/settings", "/dashboard", "/attendance", "/reports"]) revalidatePath(path);
  // a holiday changes how its days are paid (worked hours × the holiday multiplier, no absence)
  refreshPayCalculations();
}

async function mayEditSettings() {
  const user = await getSession();
  return Boolean(user && hasPermission(user, "settings"));
}

export async function addHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  if (!(await mayEditSettings())) return { error: t.validation.notAllowed };
  const parsed = holidaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  const { from, to } = parsed.data;
  if (to < from) return { error: t.holidays.endBeforeStart };
  if (daysBetween(from, to) > MAX_DAYS) return { error: t.holidays.tooLong };
  const actor = await getSession();

  return gate(
    {
      actionKey: "settings.holiday.add",
      module: t.nav.settings,
      actionLabel: t.auditActions.addHoliday,
      summary: `${parsed.data.name} — ${from}${to !== from ? ` → ${to}` : ""}`,
    },
    parsed.data,
    () => applyAddHoliday(parsed.data, actor?.name ?? t.auditActions.system),
  );
}

export async function applyAddHoliday(payload: HolidayPayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { name, from, to } = payload;
  await recordChangeAs(
    actorName,
    { module: t.nav.settings, action: t.auditActions.addHoliday, newValue: `${name} — ${from} → ${to}` },
    async (tx) => {
      await tx.holiday.create({ data: { name, from: dateOnly(from), to: dateOnly(to) } });
      // Days already marked absent before the holiday was entered: those people weren't absent, the
      // factory was closed. Only automatic absences go (no punches, no HR correction); anything
      // with a punch or a correction stays as it is.
      await tx.dailyAttendance.deleteMany({
        where: { date: { gte: dateOnly(from), lte: dateOnly(to) }, status: "absent", actualIn: null, correctionReason: null },
      });
    },
  );
  revalidateAttendance();
  return { success: true, message: t.holidays.added };
}

export async function deleteHoliday(id: string): Promise<ActionState> {
  const t = await getT();
  if (!(await mayEditSettings())) return { error: t.validation.notAllowed };
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) return { error: t.validation.invalidData };
  const actor = await getSession();

  return gate(
    {
      actionKey: "settings.holiday.delete",
      module: t.nav.settings,
      actionLabel: t.auditActions.deleteHoliday,
      summary: holiday.name,
      targetId: id,
    },
    { id },
    () => applyDeleteHoliday({ id }, actor?.name ?? t.auditActions.system),
  );
}

/** Once removed, those days are ordinary working days again: the next attendance run (within about ten
 * minutes) records anyone who didn't punch on them, from the day absences started being tracked. */
export async function applyDeleteHoliday(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const holiday = await prisma.holiday.findUnique({ where: { id: payload.id } });
  if (!holiday) return { error: t.validation.invalidData };
  await recordChangeAs(
    actorName,
    {
      module: t.nav.settings,
      action: t.auditActions.deleteHoliday,
      oldValue: `${holiday.name} — ${holiday.from.toISOString().slice(0, 10)} → ${holiday.to.toISOString().slice(0, 10)}`,
    },
    (tx) => tx.holiday.delete({ where: { id: payload.id } }),
  );
  revalidateAttendance();
  return { success: true, message: t.holidays.deleted };
}
