// Annual-leave balance, and which absent days it pays for. Pure: no I/O, no clock of its own, and nothing is
// stored — everything is worked out on every read from the hire date, the employee's leaves and the days they
// were absent, so there is no balance column to drift and no job that has to run on the 1st of the month.
//
// All arithmetic is in QUARTER-DAYS (whole numbers), because the monthly accrual is 1.75 days = 7 quarter-days
// and adding fractions of a day in floating point drifts (twelve months must come to exactly 21 days = 84
// units). Days appear only at the edge, in `unitsToDays`.
//
// The rules:
//  - Entitlement starts once the employee has completed 6 months from the hire date; 1.75 days are added on the
//    1st of every month from the first 1st on or after that day, and the balance resets on 1 January.
//  - ANY day of absence takes a whole day from the balance first, oldest first, while a whole day is left; once
//    the balance is used up the day is charged to pay by the pay type's absence table instead.
//  - A leave counts its working days plus a weekly day off (Friday) that falls between two of its working days
//    (Thursday → Saturday is 3 days). Public holidays are never counted.

/** One day, in the integer unit the balance is kept in. */
export const UNITS_PER_DAY = 4;
/** What one month adds: 1.75 days. */
export const MONTHLY_ACCRUAL_UNITS = 7;
/** No entitlement until the employee has completed this many months from the hire date. */
export const ELIGIBILITY_MONTHS = 6;
/** An annual leave must be requested at least this long before its first day. */
export const NOTICE_HOURS = 48;

/** What kind of day a date is: the same three kinds the pay rules use. */
export type DayKind = "workday" | "weekly_off" | "holiday";
export type DayKindOf = (day: string) => DayKind;
const everyDayWorks: DayKindOf = () => "workday";

/** Leave types that are a day of absence. A mission or a short permission is not: it costs nothing and takes nothing. */
export const ABSENCE_LEAVE_TYPES = ["annual", "casual", "sick", "unpaid", "excused_absence"];

export type LeaveRequestStatus = "pending" | "approved" | "rejected";

/** What the balance reads off a leave row. */
export interface BalanceLeave {
  type: string;
  status: LeaveRequestStatus;
  /** inclusive, yyyy-MM-dd */
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
};
const DAY_MS = 86_400_000;

export const unitsToDays = (units: number) => units / UNITS_PER_DAY;

/** Every calendar day of [from, to] inclusive, yyyy-MM-dd; empty when the range is invalid. */
function calendarDays(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** The day the employee completes the eligibility period: the hire date plus 6 calendar months (clamped to month end). */
export function eligibilityDate(hireDate: string): string {
  const { y, m, d } = parts(hireDate);
  const total = y * 12 + (m - 1) + ELIGIBILITY_MONTHS;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return `${ty}-${pad(tm)}-${pad(Math.min(d, daysInMonth(ty, tm)))}`;
}

/** The first day accrual is added: the first 1st-of-the-month that falls on or after the eligibility date. */
export function firstAccrualDay(hireDate: string): string {
  const elig = eligibilityDate(hireDate);
  const { y, m, d } = parts(elig);
  if (d === 1) return elig;
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

/**
 * Quarter-days accrued in the calendar year of `asOf`, up to and including `asOf`. Accrual lands on the 1st of
 * each month from the first accrual day on, and starts over every January: the year being counted begins at its
 * own January or at the first accrual day, whichever is later.
 */
export function accruedUnits(hireDate: string, asOf: string): number {
  const { y: year, m: month } = parts(asOf);
  const { y: fy, m: fm } = parts(firstAccrualDay(hireDate));
  if (fy > year) return 0;
  const startMonth = fy < year ? 1 : fm;
  if (startMonth > month) return 0;
  return (month - startMonth + 1) * MONTHLY_ACCRUAL_UNITS;
}

/**
 * The days a leave of [from, to] charges: its working days, plus a weekly day off that sits between two of its
 * working days (a Friday inside Thursday → Saturday). A Friday at either end of the range is not counted, and a
 * public holiday never is.
 */
export function chargedLeaveDays(from: string, to: string, kindOf: DayKindOf = everyDayWorks): { day: string; kind: DayKind }[] {
  const days = calendarDays(from, to).map((day) => ({ day, kind: kindOf(day) }));
  const firstWork = days.findIndex((d) => d.kind === "workday");
  if (firstWork < 0) return [];
  const lastWork = days.map((d) => d.kind).lastIndexOf("workday");
  return days.filter((d, i) => d.kind === "workday" || (d.kind === "weekly_off" && i > firstWork && i < lastWork));
}

/** How many days a request of [from, to] charges (see chargedLeaveDays); 0 when the range is invalid. */
export function requestDays(from: string, to: string, kindOf: DayKindOf = everyDayWorks): number {
  return chargedLeaveDays(from, to, kindOf).length;
}

/** What happens to one charged day of absence. */
export interface DayCharge {
  /** A whole day of balance was left, so the day comes off the balance and not off pay. */
  coveredByBalance: boolean;
  /** A weekly day off counted only because it sits inside a leave (not a working day). */
  sandwiched: boolean;
}

/**
 * Every day of `year` up to and including `upTo` that is a charged day of absence — the days of approved
 * absence-type leaves (see chargedLeaveDays) and the days recorded absent without one — each with whether the
 * balance paid for it. Days are taken oldest first: each takes a whole day from the balance accrued by then
 * while one is left, and the rest fall to pay.
 */
export function leaveCharges(input: {
  hireDate: string;
  leaves: BalanceLeave[];
  /** days recorded absent (no approved leave), yyyy-MM-dd */
  absentDays: string[];
  year: number;
  upTo: string;
  kindOf?: DayKindOf;
}): Map<string, DayCharge> {
  const kindOf = input.kindOf ?? everyDayWorks;
  const inYear = (day: string) => day.startsWith(`${input.year}-`) && day <= input.upTo;
  const charged = new Map<string, { sandwiched: boolean }>();
  for (const l of input.leaves) {
    if (l.status !== "approved" || !ABSENCE_LEAVE_TYPES.includes(l.type)) continue;
    for (const { day, kind } of chargedLeaveDays(l.from, l.to, kindOf)) {
      if (inYear(day)) charged.set(day, { sandwiched: kind === "weekly_off" });
    }
  }
  // only a working day can be an absence: a stray "absent" record on a Friday or a holiday takes nothing
  for (const day of input.absentDays) {
    if (inYear(day) && kindOf(day) === "workday" && !charged.has(day)) charged.set(day, { sandwiched: false });
  }

  const out = new Map<string, DayCharge>();
  let consumed = 0;
  for (const day of [...charged.keys()].sort()) {
    const covered = accruedUnits(input.hireDate, day) - consumed >= UNITS_PER_DAY;
    if (covered) consumed += UNITS_PER_DAY;
    out.set(day, { coveredByBalance: covered, sandwiched: charged.get(day)!.sandwiched });
  }
  return out;
}

export interface LeaveBalance {
  year: number;
  /** The first day entitlement is added (see firstAccrualDay) and the day the 6 months are completed. */
  firstAccrual: string;
  eligibleOn: string;
  /** Has the employee completed the 6 months by `asOf`? */
  eligible: boolean;
  accruedUnits: number;
  /** Days already taken off the balance plus days of leave still ahead (pending or approved). */
  usedUnits: number;
  /** accrued − used; negative when what is ahead is already more than what has accrued. */
  balanceUnits: number;
  /** In days, for display: 3.5 */
  accruedDays: number;
  usedDays: number;
  balanceDays: number;
  /** What can be requested from the balance: its whole days — the fraction stays in it. */
  availableDays: number;
  /** Days of absence this year that the balance couldn't cover, so they were charged to pay. */
  chargedToPayDays: number;
}

/**
 * The balance of the year containing `asOf` (yyyy-MM-dd). Days up to `asOf` are settled by `leaveCharges`
 * (what the balance paid for); leave days still ahead — pending or approved — are held against it, so several
 * requests can't each count the same days.
 */
export function annualLeaveBalance(input: {
  hireDate: string;
  leaves: BalanceLeave[];
  absentDays?: string[];
  asOf: string;
  kindOf?: DayKindOf;
}): LeaveBalance {
  const { hireDate, leaves, asOf } = input;
  const kindOf = input.kindOf ?? everyDayWorks;
  const year = parts(asOf).y;
  const accrued = accruedUnits(hireDate, asOf);

  const settled = leaveCharges({ hireDate, leaves, absentDays: input.absentDays ?? [], year, upTo: asOf, kindOf });
  let covered = 0;
  let toPay = 0;
  for (const c of settled.values()) {
    if (c.coveredByBalance) covered++;
    else toPay++;
  }

  const ahead = new Set<string>();
  for (const l of leaves) {
    if (l.status === "rejected" || !ABSENCE_LEAVE_TYPES.includes(l.type)) continue;
    for (const { day } of chargedLeaveDays(l.from, l.to, kindOf)) {
      if (day > asOf && day.startsWith(`${year}-`)) ahead.add(day);
    }
  }

  const used = (covered + ahead.size) * UNITS_PER_DAY;
  const balance = accrued - used;
  return {
    year,
    firstAccrual: firstAccrualDay(hireDate),
    eligibleOn: eligibilityDate(hireDate),
    eligible: eligibilityDate(hireDate) <= asOf,
    accruedUnits: accrued,
    usedUnits: used,
    balanceUnits: balance,
    accruedDays: unitsToDays(accrued),
    usedDays: unitsToDays(used),
    balanceDays: unitsToDays(balance),
    availableDays: Math.max(0, Math.floor(balance / UNITS_PER_DAY)),
    chargedToPayDays: toPay,
  };
}

/** Why an annual-leave request is refused. Each maps to its own message. */
export type AnnualLeaveRefusal = "invalid_days" | "no_working_days" | "not_eligible" | "other_year" | "notice";

export type AnnualLeaveCheck =
  | {
      ok: true;
      days: number;
      /** of those days, how many the balance covers today and how many will be charged to pay */
      fromBalance: number;
      fromPay: number;
      balance: LeaveBalance;
    }
  | { ok: false; reason: AnnualLeaveRefusal; balance: LeaveBalance; days: number };

/** The first moment of a leave's first day, in local time (the server runs on factory time). */
function startOfDayLocal(day: string): number {
  const { y, m, d } = parts(day);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/**
 * Decides whether an annual-leave request may be filed, and how it will be paid for. `days` is what was asked
 * for; callers pass the charged days of the range, but a fractional or non-positive number is refused here (only
 * whole days can be taken). A request bigger than the balance is accepted: the balance covers what it can and
 * the rest is charged to pay.
 */
export function checkAnnualLeaveRequest(input: {
  hireDate: string;
  leaves: BalanceLeave[];
  absentDays?: string[];
  from: string;
  to: string;
  now: Date;
  days?: number;
  kindOf?: DayKindOf;
}): AnnualLeaveCheck {
  const { hireDate, leaves, from, to, now } = input;
  const kindOf = input.kindOf ?? everyDayWorks;
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const balance = annualLeaveBalance({ hireDate, leaves, absentDays: input.absentDays, asOf: today, kindOf });
  const days = input.days ?? requestDays(from, to, kindOf);
  const refuse = (reason: AnnualLeaveRefusal): AnnualLeaveCheck => ({ ok: false, reason, balance, days });

  // a range that is nothing but days off / holidays has no day to charge
  if (input.days === undefined && calendarDays(from, to).length > 0 && days === 0) return refuse("no_working_days");
  if (!Number.isInteger(days) || days < 1) return refuse("invalid_days");
  if (!balance.eligible) return refuse("not_eligible");
  // The balance is one calendar year's and resets on 1 January, so a leave has to sit inside the current year.
  if (parts(from).y !== balance.year || parts(to).y !== balance.year) return refuse("other_year");
  if (startOfDayLocal(from) - now.getTime() < NOTICE_HOURS * 3_600_000) return refuse("notice");
  const fromBalance = Math.min(days, balance.availableDays);
  return { ok: true, days, fromBalance, fromPay: days - fromBalance, balance };
}
