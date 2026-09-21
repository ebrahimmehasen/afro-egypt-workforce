import { AttendanceDay, systemEntriesFor, systemKey } from "@/lib/attendance-deductions";
import { DayKind, LeaveForAbsence, PayTypeRules, ScheduleTimes, computeDayPay } from "@/lib/pay-engine";
import { PayEmployee } from "@/lib/pay-context";

/** A posted system entry as stored, including one that was edited or removed by hand. */
export interface PostedEntry {
  systemKey: string;
  amount: number;
  originalAmount: number | null;
  editedBy: string | null;
  removed: boolean;
}

export interface DayPayLine {
  type: string;
  direction: "deduction" | "addition";
  /** What counts now: the edited value if someone changed it, 0 if removed, else the calculated one. */
  amount: number;
  /** What the system calculated. */
  calculated: number;
  reason: string;
  editedBy: string | null;
  removed: boolean;
  /** Not posted yet (today, or before the next run). */
  pending: boolean;
}

export interface DayPayRow {
  date: string;
  kind: DayKind;
  thursday: boolean;
  actualIn: Date | null;
  actualOut: Date | null;
  status: string;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  overtimeMultiplier: number;
  /** counted overtime hours × multiplier */
  overtimePayHours: number;
  lines: DayPayLine[];
  net: number;
}

/**
 * The daily breakdown shown on an employee's page: each day's times and what the pay rules made of them,
 * with any hand edit laid over the system's value (both shown), so it is always clear what the system
 * calculated and what a person changed.
 */
export function dayPayRows(opts: {
  employee: PayEmployee;
  rules: PayTypeRules;
  schedule: ScheduleTimes;
  days: (AttendanceDay & { kind: DayKind })[];
  leaveFor: (date: string) => (LeaveForAbsence & { type: string }) | null;
  posted: PostedEntry[];
}): DayPayRow[] {
  const byKey = new Map(opts.posted.map((p) => [p.systemKey, p]));
  return opts.days.map((day) => {
    const leave = opts.leaveFor(day.date);
    const entries = systemEntriesFor(day, opts.employee, opts.rules, opts.schedule, day.kind, leave);
    const pay = computeDayPay({
      date: day.date,
      kind: day.kind,
      schedule: opts.schedule,
      rules: opts.rules,
      pay: opts.employee,
      actualIn: day.actualIn,
      actualOut: day.actualOut,
      hasPermission: leave?.type === "permission",
    });

    const line = (key: string, type: string, direction: DayPayLine["direction"], calculated: number, reason: string): DayPayLine => {
      const posted = byKey.get(key);
      if (!posted) return { type, direction, amount: calculated, calculated, reason, editedBy: null, removed: false, pending: true };
      const systemValue = posted.originalAmount ?? calculated;
      return {
        type,
        direction,
        amount: posted.removed ? 0 : posted.amount,
        calculated: systemValue,
        reason,
        editedBy: posted.editedBy,
        removed: posted.removed,
        pending: false,
      };
    };
    const lines = [
      ...entries.deductions.map((d) => line(d.systemKey, d.type, "deduction", d.amount, d.reason)),
      ...entries.additions.map((a) => line(a.systemKey, a.kind, "addition", a.amount, a.reason)),
    ];
    // entries a person kept after the system stopped calculating them (edited) still count
    for (const kind of ["late", "absence", "permission", "unauthorized_exit", "overtime", "friday", "holiday", "thursday_extra"]) {
      const key = systemKey(day.employeeId, day.date, kind);
      const posted = byKey.get(key);
      if (posted && posted.editedBy && !lines.some((l) => l.type === kind)) {
        const direction = ["overtime", "friday", "holiday", "thursday_extra"].includes(kind) ? "addition" : "deduction";
        lines.push({ type: kind, direction, amount: posted.removed ? 0 : posted.amount, calculated: posted.originalAmount ?? 0, reason: "", editedBy: posted.editedBy, removed: posted.removed, pending: false });
      }
    }

    const overtime = pay.items.find((i) => i.kind === "overtime");
    const net = lines.reduce((s, l) => s + (l.direction === "addition" ? l.amount : -l.amount), 0);
    return {
      date: day.date,
      kind: day.kind,
      thursday: pay.times.thursdayExtra !== null || (opts.rules.thursdayRuleEnabled && new Date(`${day.date}T00:00:00Z`).getUTCDay() === 4),
      actualIn: day.actualIn,
      actualOut: day.actualOut,
      status: day.status,
      workedMinutes: pay.workedMinutes,
      lateMinutes: pay.lateMinutes,
      overtimeMinutes: pay.overtimeCountedMinutes,
      overtimeMultiplier: opts.rules.overtimeMultiplier,
      overtimePayHours: overtime?.payHours ?? 0,
      lines,
      net,
    };
  });
}
