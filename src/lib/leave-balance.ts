// Annual-leave balance. Pure: no I/O, no clock of its own, and nothing is stored — the balance is worked out on
// every read from the hire date plus the employee's annual leaves, so there is no balance column to drift and no
// job that has to run on the 1st of the month.
//
// All arithmetic is in QUARTER-DAYS (whole numbers), because the monthly accrual is 1.75 days = 7 quarter-days
// and adding fractions of a day in floating point drifts (twelve months must come to exactly 21 days = 84
// units). Days appear only at the edge, in `unitsToDays`.
//
// A leave is counted in WORKING days: the weekly day off (Friday) and public holidays that fall inside it are not
// charged to the balance. Which days those are comes in as `isOffDay`, read by the caller from the settings, so
// this file stays free of any I/O.

/** One day, in the integer unit the balance is kept in. */
export const UNITS_PER_DAY = 4;
/** What one month adds: 1.75 days. */
export const MONTHLY_ACCRUAL_UNITS = 7;
/** No entitlement until the employee has completed this many months from the hire date. */
export const ELIGIBILITY_MONTHS = 6;
/** An annual leave must be requested at least this long before its first day. */
export const NOTICE_HOURS = 48;

/** True for a day that never counts toward a leave: the weekly day off or a public holiday. */
export type IsOffDay = (day: string) => boolean;
const noOffDays: IsOffDay = () => false;

export type LeaveRequestStatus = "pending" | "approved" | "rejected";

/** What the balance reads off a leave row. Only `annual` leaves that aren't rejected ever count. */
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

export const unitsToDays = (units: number) => units / UNITS_PER_DAY;

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
 * each month from the first accrual day on, and starts over every January: the balance of a year never carries
 * into the next, so the year being counted begins at its own January or at the first accrual day, whichever is later.
 */
export function accruedUnits(hireDate: string, asOf: string): number {
  const { y: year, m: month } = parts(asOf);
  const first = firstAccrualDay(hireDate);
  const { y: fy, m: fm } = parts(first);
  if (fy > year) return 0;
  const startMonth = fy < year ? 1 : fm;
  if (startMonth > month) return 0;
  return (month - startMonth + 1) * MONTHLY_ACCRUAL_UNITS;
}

const DAY_MS = 86_400_000;

/** The days of [from, to] (inclusive), as yyyy-MM-dd strings, keeping only those `keep` accepts. */
function eachDay(from: string, to: string, keep: (day: string) => boolean): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  let n = 0;
  for (let t = start; t <= end; t += DAY_MS) {
    if (keep(new Date(t).toISOString().slice(0, 10))) n++;
  }
  return n;
}

/** Days of [from, to] (inclusive) that fall inside `year` and count toward a leave (not a day off or holiday). */
export function daysInYear(from: string, to: string, year: number, isOffDay: IsOffDay = noOffDays): number {
  return eachDay(from, to, (day) => day.startsWith(`${year}-`) && !isOffDay(day));
}

/** Days a request would charge, inclusive of both ends, skipping the weekly day off and public holidays; 0 when the range is invalid. */
export function requestDays(from: string, to: string, isOffDay: IsOffDay = noOffDays): number {
  return eachDay(from, to, (day) => !isOffDay(day));
}

/** Quarter-days already spoken for in `year`: annual leaves that are pending or approved (rejected ones are free). */
export function reservedUnits(leaves: BalanceLeave[], year: number, isOffDay: IsOffDay = noOffDays): number {
  return leaves
    .filter((l) => l.type === "annual" && l.status !== "rejected")
    .reduce((sum, l) => sum + daysInYear(l.from, l.to, year, isOffDay) * UNITS_PER_DAY, 0);
}

export interface LeaveBalance {
  year: number;
  /** The first day entitlement is added (see firstAccrualDay) and the day the 6 months are completed. */
  firstAccrual: string;
  eligibleOn: string;
  /** Has the employee completed the 6 months by `asOf`? */
  eligible: boolean;
  accruedUnits: number;
  usedUnits: number;
  /** accrued − used; goes negative only when older leaves already exceed what has accrued. */
  balanceUnits: number;
  /** In days, for display: 3.5 */
  accruedDays: number;
  usedDays: number;
  balanceDays: number;
  /** What can be requested: the whole days of the balance — the fraction stays in the balance. */
  availableDays: number;
}

/** The balance of the year containing `asOf` (yyyy-MM-dd), from the hire date and the employee's leaves. */
export function annualLeaveBalance(
  hireDate: string,
  leaves: BalanceLeave[],
  asOf: string,
  isOffDay: IsOffDay = noOffDays,
): LeaveBalance {
  const year = parts(asOf).y;
  const accrued = accruedUnits(hireDate, asOf);
  const used = reservedUnits(leaves, year, isOffDay);
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
  };
}

/** Why an annual-leave request is refused. Each maps to its own message. */
export type AnnualLeaveRefusal = "invalid_days" | "no_working_days" | "not_eligible" | "other_year" | "notice" | "exceeds_balance";

export type AnnualLeaveCheck =
  | { ok: true; days: number; balance: LeaveBalance }
  | { ok: false; reason: AnnualLeaveRefusal; balance: LeaveBalance; days: number };

/** The first moment of a leave's first day, in local time (the server runs on factory time). */
function startOfDayLocal(day: string): number {
  const { y, m, d } = parts(day);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/**
 * Decides whether an annual-leave request may be filed. `days` is what was asked for; callers pass the whole days
 * of the range, but a fractional or non-positive number is refused here (only whole days can be taken). Order of
 * the checks is the order an employee would want to hear about them.
 *
 * `leaves` are the employee's leaves already on file (it need not be filtered); `now` is the moment of the request.
 */
export function checkAnnualLeaveRequest(input: {
  hireDate: string;
  leaves: BalanceLeave[];
  from: string;
  to: string;
  now: Date;
  days?: number;
  /** The weekly day off and public holidays — they are not charged to the balance. */
  isOffDay?: IsOffDay;
}): AnnualLeaveCheck {
  const { hireDate, leaves, from, to, now } = input;
  const isOffDay = input.isOffDay ?? noOffDays;
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const balance = annualLeaveBalance(hireDate, leaves, today, isOffDay);
  const days = input.days ?? requestDays(from, to, isOffDay);
  const refuse = (reason: AnnualLeaveRefusal): AnnualLeaveCheck => ({ ok: false, reason, balance, days });

  // a range that is nothing but days off / holidays has no day to charge
  if (input.days === undefined && requestDays(from, to) > 0 && days === 0) return refuse("no_working_days");
  if (!Number.isInteger(days) || days < 1) return refuse("invalid_days");
  if (!balance.eligible) return refuse("not_eligible");
  // The balance is one calendar year's and resets on 1 January, so a leave has to sit inside the current year.
  if (parts(from).y !== balance.year || parts(to).y !== balance.year) return refuse("other_year");
  if (startOfDayLocal(from) - now.getTime() < NOTICE_HOURS * 3_600_000) return refuse("notice");
  if (days > balance.availableDays) return refuse("exceeds_balance");
  return { ok: true, days, balance };
}
