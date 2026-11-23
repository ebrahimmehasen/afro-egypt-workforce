// A record that HR classified an exit stretch as a mission or an excused absence. It is a note and nothing more:
// no Leave row, no new pay rule, and nothing in the pay code reads it — the stretch is charged exactly as it was.
//
// Where it lives: an audit-log entry (who, when, what, why), the append-only record the system already keeps for
// every change. The machine-readable key is the entry's `oldValue` (pipe-separated, language-independent); the
// readable text is its `newValue` and `reason`. Pure here; the action writes it and the day view reads it back.

export const ANNOTATION_TAG = "exit-annotation:v1";
export const ANNOTATION_TYPES = ["mission", "excused_absence"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export interface ExitAnnotationKey {
  employeeId: string;
  date: string;
  /** The punch the employee went out on, and the one they came back on (ISO). */
  out: string;
  back: string;
  type: AnnotationType;
}

export interface ExitAnnotation extends ExitAnnotationKey {
  by: string;
  at: Date;
  reason: string;
}

/** The entry's `oldValue`: the key that says which stretch of which day the note is about. */
export function annotationKey(k: ExitAnnotationKey): string {
  return [ANNOTATION_TAG, k.employeeId, k.date, k.out, k.back, k.type].join("|");
}

/** The key back out of an `oldValue`; null for any other audit entry. */
export function parseAnnotationKey(oldValue: string): ExitAnnotationKey | null {
  const [tag, employeeId, date, out, back, type] = oldValue.split("|");
  if (tag !== ANNOTATION_TAG || !employeeId || !date || !out || !back) return null;
  if (!(ANNOTATION_TYPES as readonly string[]).includes(type)) return null;
  return { employeeId, date, out, back, type: type as AnnotationType };
}

/**
 * The latest note per stretch, from audit entries (any order). Entries that are not exit notes are ignored, so the
 * whole audit table can be passed. Keyed by `employeeId|date|out`.
 */
export function latestAnnotations(entries: { oldValue: string; userName: string; timestamp: Date; reason: string | null }[]): Map<string, ExitAnnotation> {
  const out = new Map<string, ExitAnnotation>();
  for (const e of entries) {
    const key = parseAnnotationKey(e.oldValue);
    if (!key) continue;
    const id = `${key.employeeId}|${key.date}|${key.out}`;
    const seen = out.get(id);
    if (!seen || seen.at < e.timestamp) out.set(id, { ...key, by: e.userName, at: e.timestamp, reason: e.reason ?? "" });
  }
  return out;
}
