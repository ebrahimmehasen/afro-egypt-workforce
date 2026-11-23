// Quarantined punches: copies of a punch that an hour-shift correction left behind.
//
// When the fingerprint device's clock was an hour out, the stored punches were moved back an hour by hand and the
// device's original record of each (still in its log, under the wrong stamp) was imported again by the next
// catch-up. Those copies sit one hour after the corrected punch, so every calculation that reads punches would
// count the person as having been there an hour longer, or as having left and come back.
//
// A copy is not deleted (the row is the importer's proof that the device's record was already taken, and the raw
// table is evidence): it is marked in `rawPayload` with the id of the corrected punch it duplicates. Every
// calculation leaves marked rows out (`withoutQuarantined`); the raw views still list them, labelled. A marked
// row keeps its `timestamp`, so the importer still finds it when it re-reads the device's log.

import type { Prisma } from "@prisma/client";

export const QUARANTINE_KEY = "duplicateOfCorrection";

export interface QuarantineMarker {
  /** The corrected punch this row is a copy of. */
  twinId: string;
  /** The stamp the correction moved the twin from — the stamp this row holds. */
  correctionStamp: string;
  /** When the row was marked. */
  markedAt: string;
}

const HOUR_MS = 60 * 60_000;
const ISO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function asObject(rawPayload: unknown): Record<string, unknown> | null {
  return rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload) ? (rawPayload as Record<string, unknown>) : null;
}

/** The marker on a punch's raw payload, or null when it is an ordinary punch. */
export function quarantineOf(rawPayload: unknown): QuarantineMarker | null {
  const marker = asObject(asObject(rawPayload)?.[QUARANTINE_KEY]);
  if (!marker || typeof marker.twinId !== "string" || typeof marker.correctionStamp !== "string") return null;
  return { twinId: marker.twinId, correctionStamp: marker.correctionStamp, markedAt: typeof marker.markedAt === "string" ? marker.markedAt : "" };
}

export const isQuarantined = (rawPayload: unknown): boolean => quarantineOf(rawPayload) !== null;

/** The rows a calculation may read: everything except quarantined copies. */
export function withoutQuarantined<T extends { rawPayload?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => !isQuarantined(r.rawPayload));
}

/** The stamp a correction moved a punch from (`rawPayload.timestampCorrectedFrom`), as a time, or null. */
export function correctedFrom(rawPayload: unknown): Date | null {
  const stamp = asObject(rawPayload)?.timestampCorrectedFrom;
  if (typeof stamp !== "string" || !ISO_MILLIS.test(stamp)) return null;
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? null : at;
}

export interface LineageRow {
  id: string;
  employeeId: string;
  timestamp: Date;
  source: string;
  rawPayload: unknown;
}

export interface LineagePair {
  duplicateId: string;
  twinId: string;
  correctionStamp: string;
}

/**
 * Which rows are copies of a corrected punch. A corrected punch (the twin) carries the stamp it was moved from.
 * Its copy is a biometric row of the same employee that holds exactly that stamp, one hour after the twin, and
 * is not itself a corrected or already marked punch. Anything less exact is left alone, and a twin with several
 * candidates (or a candidate several twins claim) is reported as ambiguous instead of guessed.
 */
export function findDuplicateLineage(rows: LineageRow[]): { pairs: LineagePair[]; ambiguous: { twinId: string; candidateIds: string[] }[] } {
  const byEmployee = new Map<string, LineageRow[]>();
  for (const r of rows) {
    if (r.source !== "biometric") continue;
    const list = byEmployee.get(r.employeeId);
    if (list) list.push(r);
    else byEmployee.set(r.employeeId, [r]);
  }

  const candidatesByTwin = new Map<string, LineageRow[]>();
  const claimsByCandidate = new Map<string, string[]>();
  for (const list of byEmployee.values()) {
    const byTime = new Map<number, LineageRow[]>();
    for (const r of list) {
      const at = r.timestamp.getTime();
      const same = byTime.get(at);
      if (same) same.push(r);
      else byTime.set(at, [r]);
    }
    for (const twin of list) {
      const from = correctedFrom(twin.rawPayload);
      if (!from || twin.timestamp.getTime() + HOUR_MS !== from.getTime()) continue;
      const found = (byTime.get(from.getTime()) ?? []).filter((c) => c.id !== twin.id && correctedFrom(c.rawPayload) === null && !isQuarantined(c.rawPayload));
      if (found.length === 0) continue;
      candidatesByTwin.set(twin.id, found);
      for (const c of found) claimsByCandidate.set(c.id, [...(claimsByCandidate.get(c.id) ?? []), twin.id]);
    }
  }

  const pairs: LineagePair[] = [];
  const ambiguous: { twinId: string; candidateIds: string[] }[] = [];
  for (const [twinId, found] of candidatesByTwin) {
    const [only] = found;
    if (found.length === 1 && claimsByCandidate.get(only.id)?.length === 1) {
      pairs.push({ duplicateId: only.id, twinId, correctionStamp: only.timestamp.toISOString() });
    } else {
      ambiguous.push({ twinId, candidateIds: found.map((c) => c.id) });
    }
  }
  return { pairs, ambiguous };
}

/** The raw payload of a row once marked: whatever it held, plus the marker. */
export function markedPayload(existing: unknown, pair: LineagePair, markedAt: Date): Prisma.InputJsonObject {
  const marker = { twinId: pair.twinId, correctionStamp: pair.correctionStamp, markedAt: markedAt.toISOString() };
  return { ...((asObject(existing) ?? {}) as Prisma.InputJsonObject), [QUARANTINE_KEY]: marker };
}
