// The exit and return times HR enters for a day after reviewing it (a forgotten punch). Pure.
//
// They are stored as extra AttendanceLog rows — never an edit of a punch that exists — and the pay engine reads them
// as ordinary punches in the middle of the day (mid-day-exits.ts, HR_REVIEW_SOURCE), also on a day HR has corrected.
// The log's `source` column is a database enum (simulated, manual_correction, biometric) and adding a value would be a
// schema change, so a reviewed punch is stored as source "manual_correction" with this marker in rawPayload, and the
// engine is handed the distinct source "hr_review" by `punchEngineSource`. An HR in/out pair added by hand
// (addManualAttendance) has no marker and is still never read as a mid-day exit.
import { DUPLICATE_PUNCH_MS, HR_REVIEW_SOURCE } from "@/lib/mid-day-exits";

export type ReviewedRole = "out" | "back";

export interface HrReviewMarker {
  by: string;
  reason: string;
  /** when HR entered it (ISO) */
  at: string;
  role: ReviewedRole;
}

export const hrReviewPayload = (marker: HrReviewMarker) => ({ hrReview: marker });

export function isHrReviewPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const marker = (raw as { hrReview?: unknown }).hrReview;
  return Boolean(marker && typeof marker === "object" && typeof (marker as { by?: unknown }).by === "string");
}

/** The source the pay engine sees for a stored punch: "hr_review" for a reviewed one, else the stored source. */
export const punchEngineSource = (log: { source: string; rawPayload?: unknown }): string => (isHrReviewPayload(log.rawPayload) ? HR_REVIEW_SOURCE : log.source);

export type ReviewedTimesError = "needOne" | "badTime" | "backBeforeOut" | "outsideDay" | "duplicate";

/**
 * The times HR may enter: an exit and/or a return (HH:MM), each strictly inside the day's check-in and check-out
 * (so the day's first and last punch — its in and out — stay exactly as they are), a return after the exit, and not
 * on top of a punch that is already there. Nothing is estimated here: every time is one HR typed.
 */
export function reviewedTimes(input: {
  date: string;
  actualIn: Date | null;
  actualOut: Date | null;
  outTime?: string;
  backTime?: string;
  /** the punches the employee already has around the day */
  existing: Date[];
}): { ok: true; out: Date | null; back: Date | null } | { ok: false; error: ReviewedTimesError } {
  const clean = (v?: string) => (v && v.trim() ? v.trim() : null);
  const outTime = clean(input.outTime);
  const backTime = clean(input.backTime);
  if (!outTime && !backTime) return { ok: false, error: "needOne" };
  const parse = (time: string | null) => {
    if (!time) return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
    return new Date(`${input.date}T${time}:00`);
  };
  const out = parse(outTime);
  const back = parse(backTime);
  if (out === undefined || back === undefined) return { ok: false, error: "badTime" };
  if (out && back && back.getTime() <= out.getTime()) return { ok: false, error: "backBeforeOut" };
  if (!input.actualIn || !input.actualOut) return { ok: false, error: "outsideDay" };
  const first = input.actualIn.getTime() + DUPLICATE_PUNCH_MS;
  const last = input.actualOut.getTime() - DUPLICATE_PUNCH_MS;
  for (const at of [out, back]) {
    if (!at) continue;
    if (at.getTime() < first || at.getTime() > last) return { ok: false, error: "outsideDay" };
    if (input.existing.some((e) => Math.abs(e.getTime() - at.getTime()) < DUPLICATE_PUNCH_MS)) return { ok: false, error: "duplicate" };
  }
  return { ok: true, out, back };
}
