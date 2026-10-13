import { describe, expect, it } from "vitest";
import {
  MONTHLY_ACCRUAL_UNITS,
  UNITS_PER_DAY,
  accruedUnits,
  annualLeaveBalance,
  checkAnnualLeaveRequest,
  daysInYear,
  eligibilityDate,
  firstAccrualDay,
  requestDays,
  type BalanceLeave,
} from "@/lib/leave-balance";

const annual = (from: string, to: string, status: BalanceLeave["status"] = "approved"): BalanceLeave => ({
  type: "annual", status, from, to,
});

describe("when entitlement starts", () => {
  it("is zero for an employee who hasn't completed 6 months", () => {
    const hire = "2026-03-10"; // completes 6 months on 2026-09-10
    expect(annualLeaveBalance(hire, [], "2026-08-15")).toMatchObject({ eligible: false, accruedUnits: 0, availableDays: 0 });
    expect(annualLeaveBalance(hire, [], "2026-09-09").eligible).toBe(false);
  });

  it("the day the 6 months are completed they are eligible, but nothing has accrued until the next 1st", () => {
    const hire = "2026-01-15";
    expect(eligibilityDate(hire)).toBe("2026-07-15");
    expect(firstAccrualDay(hire)).toBe("2026-08-01");
    expect(annualLeaveBalance(hire, [], "2026-07-15")).toMatchObject({ eligible: true, accruedUnits: 0, availableDays: 0 });
    expect(annualLeaveBalance(hire, [], "2026-07-31").accruedUnits).toBe(0);
  });

  it("completing the 6 months exactly on a 1st accrues that very day", () => {
    const hire = "2026-01-01";
    expect(firstAccrualDay(hire)).toBe("2026-07-01");
    expect(annualLeaveBalance(hire, [], "2026-07-01")).toMatchObject({ accruedUnits: 7, accruedDays: 1.75, availableDays: 1 });
  });

  it("clamps to the end of a short month", () => {
    expect(eligibilityDate("2025-08-31")).toBe("2026-02-28");
    expect(firstAccrualDay("2025-08-31")).toBe("2026-03-01");
  });

  it("rolls the first accrual into the next year when the 6 months end in December", () => {
    expect(eligibilityDate("2026-06-20")).toBe("2026-12-20");
    expect(firstAccrualDay("2026-06-20")).toBe("2027-01-01");
  });
});

describe("the monthly balance", () => {
  const hire = "2026-01-15"; // first accrual 2026-08-01

  it("first accrual month: 1.75 days, 1 available", () => {
    expect(annualLeaveBalance(hire, [], "2026-08-01")).toMatchObject({ accruedDays: 1.75, balanceDays: 1.75, availableDays: 1 });
    expect(annualLeaveBalance(hire, [], "2026-08-31").availableDays).toBe(1);
  });

  it("two months without taking any: 3.5 days, 3 available", () => {
    expect(annualLeaveBalance(hire, [], "2026-09-10")).toMatchObject({ accruedDays: 3.5, balanceDays: 3.5, availableDays: 3 });
  });

  it("two months after taking one day: 2.5 days, 2 available", () => {
    const leaves = [annual("2026-08-20", "2026-08-20")];
    expect(annualLeaveBalance(hire, leaves, "2026-08-25")).toMatchObject({ balanceDays: 0.75, availableDays: 0 });
    expect(annualLeaveBalance(hire, leaves, "2026-09-10")).toMatchObject({ accruedDays: 3.5, usedDays: 1, balanceDays: 2.5, availableDays: 2 });
  });

  it("the unspent fraction stays in the balance and joins the next month's accrual", () => {
    const leaves = [annual("2026-08-20", "2026-08-20")];
    expect(annualLeaveBalance(hire, leaves, "2026-08-25").balanceUnits).toBe(3); // 0.75 day
    // + 1.75 on 1 Sep = 2.5 — the 0.75 was not rounded away or paid out
    expect(annualLeaveBalance(hire, leaves, "2026-09-01").balanceUnits).toBe(10);
  });

  it("twelve consecutive months of accrual, none taken, come to exactly 21 days (84 units) with no fraction error", () => {
    const b = annualLeaveBalance("2024-01-01", [], "2026-12-31");
    expect(b.accruedUnits).toBe(12 * MONTHLY_ACCRUAL_UNITS);
    expect(b.accruedUnits).toBe(84);
    expect(b.accruedDays).toBe(21);
    expect(b.balanceDays).toBe(21);
    expect(b.availableDays).toBe(21);
    // month by month the units are exact integers all the way through
    for (let m = 1; m <= 12; m++) {
      const units = accruedUnits("2024-01-01", `2026-${String(m).padStart(2, "0")}-15`);
      expect(units).toBe(m * 7);
      expect(Number.isInteger(units)).toBe(true);
    }
  });

  it("an employee who becomes eligible mid-year accrues only from their first accrual month", () => {
    // hired 2026-03-10 -> eligible 2026-09-10 -> first accrual 2026-10-01
    expect(accruedUnits("2026-03-10", "2026-12-15")).toBe(3 * 7);
    expect(accruedUnits("2026-03-10", "2026-09-30")).toBe(0);
  });
});

describe("what counts as used", () => {
  const hire = "2024-01-01";

  it("pending leaves are deducted; rejected ones are not", () => {
    const leaves = [annual("2026-03-02", "2026-03-03", "pending"), annual("2026-04-01", "2026-04-05", "rejected")];
    const b = annualLeaveBalance(hire, leaves, "2026-06-10");
    expect(b.usedDays).toBe(2); // only the pending one
    expect(b.accruedDays).toBe(10.5); // 6 months
    expect(b.balanceDays).toBe(8.5);
    expect(b.availableDays).toBe(8);
  });

  it("approved leaves are deducted", () => {
    expect(annualLeaveBalance(hire, [annual("2026-03-02", "2026-03-06")], "2026-06-10").usedDays).toBe(5);
  });

  it("only annual leave touches the balance — casual, sick, unpaid and the rest do not", () => {
    for (const type of ["casual", "sick", "unpaid", "mission", "permission", "excused_absence"]) {
      const b = annualLeaveBalance(hire, [{ type, status: "approved", from: "2026-03-02", to: "2026-03-06" }], "2026-06-10");
      expect(b.usedUnits).toBe(0);
    }
  });

  it("a leave that spans New Year only charges the days inside the year being counted", () => {
    expect(daysInYear("2026-12-30", "2027-01-03", 2026)).toBe(2);
    expect(daysInYear("2026-12-30", "2027-01-03", 2027)).toBe(3);
    expect(daysInYear("2026-12-30", "2027-01-03", 2028)).toBe(0);
  });

  it("the balance resets on 1 January: last year's leaves and unspent days don't carry over", () => {
    const leaves = [annual("2026-03-02", "2026-03-06")];
    const lastDay = annualLeaveBalance(hire, leaves, "2026-12-31");
    expect(lastDay.accruedUnits).toBe(84);
    expect(lastDay.usedDays).toBe(5);
    expect(lastDay.balanceDays).toBe(16);
    const newYear = annualLeaveBalance(hire, leaves, "2027-01-01");
    expect(newYear).toMatchObject({ year: 2027, accruedUnits: 7, usedUnits: 0, balanceDays: 1.75, availableDays: 1 });
  });

  it("an employee who passed 6 months continues from January", () => {
    // first accrual late in 2026; in 2027 accrual starts again in January, not at the old first-accrual month
    expect(accruedUnits("2026-03-10", "2027-01-20")).toBe(7);
    expect(accruedUnits("2026-03-10", "2027-03-20")).toBe(21);
  });
});

describe("filing an annual leave", () => {
  // 2026-09-10 12:00 local time
  const now = new Date(2026, 8, 10, 12, 0, 0);
  const hire = "2024-01-01"; // 9 months accrued by Sept = 15.75 days -> 15 available

  const check = (over: Partial<Parameters<typeof checkAnnualLeaveRequest>[0]> = {}) =>
    checkAnnualLeaveRequest({ hireDate: hire, leaves: [], from: "2026-09-20", to: "2026-09-20", now, ...over });

  it("accepts one whole day within the balance and with enough notice", () => {
    const r = check();
    expect(r.ok).toBe(true);
    expect(r.days).toBe(1);
    expect(r.balance.availableDays).toBe(15);
  });

  it("rejects a half day (only whole days can be taken)", () => {
    expect(check({ days: 0.5 })).toMatchObject({ ok: false, reason: "invalid_days" });
    expect(check({ days: 1.5 })).toMatchObject({ ok: false, reason: "invalid_days" });
  });

  it("rejects a range that ends before it starts, or a zero-day request", () => {
    expect(check({ from: "2026-09-22", to: "2026-09-20" })).toMatchObject({ ok: false, reason: "invalid_days" });
    expect(check({ days: 0 })).toMatchObject({ ok: false, reason: "invalid_days" });
  });

  it("rejects more than the available whole days — the fraction can't be borrowed", () => {
    expect(check({ from: "2026-09-14", to: "2026-09-28" }).ok).toBe(true); // exactly 15 days
    expect(check({ from: "2026-09-14", to: "2026-09-29" })).toMatchObject({ ok: false, reason: "exceeds_balance", days: 16 });
  });

  it("counts requests already on file, so several small requests can't add up to more than the balance", () => {
    const leaves = [annual("2026-09-21", "2026-10-01", "pending")]; // 11 days reserved -> 4.75 left, 4 available
    expect(check({ leaves, from: "2026-10-05", to: "2026-10-08" }).ok).toBe(true);
    expect(check({ leaves, from: "2026-10-05", to: "2026-10-09" })).toMatchObject({ ok: false, reason: "exceeds_balance" });
  });

  it("a rejected request frees its days again", () => {
    const leaves = [annual("2026-09-21", "2026-10-01", "rejected")];
    expect(check({ leaves, from: "2026-10-05", to: "2026-10-19" }).ok).toBe(true); // 15 days
  });

  it("needs 48 hours' notice: 36 hours before is refused, 60 hours before is fine", () => {
    // now = 10 Sep 12:00. A leave starting 12 Sep 00:00 is 36h away, one starting 13 Sep 00:00 is 60h away.
    expect(check({ from: "2026-09-12", to: "2026-09-12" })).toMatchObject({ ok: false, reason: "notice" });
    expect(check({ from: "2026-09-13", to: "2026-09-13" }).ok).toBe(true);
    expect(check({ from: "2026-09-10", to: "2026-09-10" })).toMatchObject({ ok: false, reason: "notice" });
  });

  it("exactly 48 hours before is enough", () => {
    const midnight = new Date(2026, 8, 10, 0, 0, 0); // 10 Sep 00:00 -> leave on 12 Sep 00:00 is exactly 48h
    expect(check({ now: midnight, from: "2026-09-12", to: "2026-09-12" }).ok).toBe(true);
  });

  it("refuses an employee who hasn't completed 6 months", () => {
    expect(check({ hireDate: "2026-06-01" })).toMatchObject({ ok: false, reason: "not_eligible" });
  });

  it("refuses an eligible employee with nothing accrued yet (exceeds the empty balance)", () => {
    // hired 2026-03-10: eligible on 2026-09-10 but the first accrual is 2026-10-01
    expect(check({ hireDate: "2026-03-10" })).toMatchObject({ ok: false, reason: "exceeds_balance" });
  });

  it("a leave must sit inside the current year, because the balance resets on 1 January", () => {
    expect(check({ from: "2026-12-30", to: "2027-01-02" })).toMatchObject({ ok: false, reason: "other_year" });
    expect(check({ from: "2027-01-05", to: "2027-01-05" })).toMatchObject({ ok: false, reason: "other_year" });
  });

  it("a request for the day of the move to a new year uses the new year's balance of zero before January accrues", () => {
    expect(requestDays("2026-09-20", "2026-09-22")).toBe(3);
    expect(UNITS_PER_DAY).toBe(4);
  });
});
