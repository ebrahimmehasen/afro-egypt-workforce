import { Mission } from "@prisma/client";

/** Pieces of a Mission row that the day-level helpers below need. */
export type MissionDayFields = Pick<Mission, "startTime" | "endTime" | "confirmedEnd" | "durationMinutes">;

const atTime = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`);

/** A date-range mission (no startTime) covers every day in [from, to] as a whole day — no deductions, like a leave. */
export function isFullDayMission(mission: Pick<Mission, "startTime">): boolean {
  return !mission.startTime;
}

/** The timed mission's window on one of its days: null when it's a full-day (range) mission instead. */
export function missionWindowForDay(mission: MissionDayFields, date: string): { start: Date; end: Date | null } | null {
  if (!mission.startTime) return null;
  return { start: atTime(date, mission.startTime), end: mission.endTime ? atTime(date, mission.endTime) : missionResolvedEnd(mission, date) };
}

/**
 * When the employee never punched back in: HR's confirmed end time, or the mission's start plus the duration
 * HR set — whichever was given. Null while neither has been set yet (HR must still resolve it, or correct the
 * return punch) and the mission itself has no endTime either.
 */
export function missionResolvedEnd(mission: MissionDayFields, date: string): Date | null {
  if (mission.confirmedEnd) return atTime(date, mission.confirmedEnd);
  if (mission.durationMinutes != null && mission.startTime) {
    return new Date(atTime(date, mission.startTime).getTime() + mission.durationMinutes * 60_000);
  }
  return null;
}

/** "yyyy-MM-dd" for a Mission's DateTime (@db.Date) field, comparable with the plain date strings used elsewhere. */
export const missionDayStr = (d: Date) => d.toISOString().slice(0, 10);
