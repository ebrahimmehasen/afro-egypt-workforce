import { describe, expect, it } from "vitest";
import {
  MONTHLY_ACCRUAL_UNITS,
  accruedUnits,
  annualLeaveBalance,
  chargedLeaveDays,
  checkAnnualLeaveRequest,
  eligibilityDate,
  firstAccrualDay,
  leaveCharges,
  requestDays,
  type BalanceLeave,
  type DayKindOf,
} from "@/lib/leave-balance";

const annual = (from: string, to: string, status: BalanceLeave["status"] = "approved"): BalanceLeave => ({
  type: "annual", status, from, to,
});
const balanceOf = (hireDate: string, leaves: BalanceLeave[], asOf: string, extra: { absentDays?: string[]; kindOf?: DayKindOf } = {}) =>
  annualLeaveBalance({ hireDate, leaves, asOf, ...extra });

// Friday is the weekly day off; 21 Oct 2026 (a Wednesday) is a public holiday.
const FRIDAY = 5;
const HOLIDAY = "2026-10-21";
const kindOf: DayKindOf = (day) =>
  day === HOLIDAY ? "holiday" : new Date(`${day}T00:00:00Z`).getUTCDay() === FRIDAY ? "weekly_off" : "workday";

describe("when entitlement starts", () => {
  it("is zero for an employee who hasn't completed 6 months", () => {
    const hire = "2026-03-10"; // completes 6 months on 2026-09-10
    expect(balanceOf(hire, [], "2026-08-15")).toMatchObject({ eligible: false, accruedUnits: 0, availableDays: 0 });
    expect(balanceOf(hire, [], "2026-09-09").eligible).toBe(false);
  });

  it("the day the 6 months are completed they are eligible, but nothing has accrued until the next 1st", () => {
    const hire = "2026-01-15";
    expect(eligibilityDate(hire)).toBe("2026-07-15");
    expect(firstAccrualDay(hire)).toBe("2026-08-01");
    expect(balanceOf(hire, [], "2026-07-15")).toMatchObject({ eligible: true, accruedUnits: 0, availableDays: 0 });
    expect(balanceOf(hire, [], "2026-07-31").accruedUnits).toBe(0);
  });

  it("completing the 6 months exactly on a 1st accrues that very day", () => {
    expect(firstAccrualDay("2026-01-01")).toBe("2026-07-01");
    expect(balanceOf("2026-01-01", [], "2026-07-01")).toMatchObject({ accruedUnits: 7, accruedDays: 1.75, availableDays: 1 });
  });

  it("clamps to the end of a short month, and rolls into January when the 6 months end in December", () => {
    expect(eligibilityDate("2025-08-31")).toBe("2026-02-28");
    expect(firstAccrualDay("2025-08-31")).toBe("2026-03-01");
    expect(firstAccrualDay("2026-06-20")).toBe("2027-01-01");
  });
});

describe("the monthly balance", () => {
  const hire = "2026-01-15"; // first accrual 2026-08-01

  it("first accrual month: 1.75 days, 1 available", () => {
    expect(balanceOf(hire, [], "2026-08-01")).toMatchObject({ accruedDays: 1.75, balanceDays: 1.75, availableDays: 1 });
  });

  it("two months without taking any: 3.5 days, 3 available", () => {
    expect(balanceOf(hire, [], "2026-09-10")).toMatchObject({ accruedDays: 3.5, balanceDays: 3.5, availableDays: 3 });
  });

  it("two months after taking one day: 2.5 days, 2 available", () => {
    const leaves = [annual("2026-08-20", "2026-08-20")];
    expect(balanceOf(hire, leaves, "2026-08-25")).toMatchObject({ balanceDays: 0.75, availableDays: 0 });
    expect(balanceOf(hire, leaves, "2026-09-10")).toMatchObject({ accruedDays: 3.5, usedDays: 1, balanceDays: 2.5, availableDays: 2 });
  });

  it("the unspent fraction stays in the balance and joins the next month's accrual", () => {
    const leaves = [annual("2026-08-20", "2026-08-20")];
    expect(balanceOf(hire, leaves, "2026-08-25").balanceUnits).toBe(3); // 0.75 day
    expect(balanceOf(hire, leaves, "2026-09-01").balanceUnits).toBe(10); // + 1.75 = 2.5
  });

  it("twelve consecutive months of accrual, none taken, come to exactly 21 days (84 units) with no fraction error", () => {
    const b = balanceOf("2024-01-01", [], "2026-12-31");
    expect(b.accruedUnits).toBe(12 * MONTHLY_ACCRUAL_UNITS);
    expect(b.accruedUnits).toBe(84);
    expect(b.accruedDays).toBe(21);
    expect(b.availableDays).toBe(21);
    for (let m = 1; m <= 12; m++) {
      const units = accruedUnits("2024-01-01", `2026-${String(m).padStart(2, "0")}-15`);
      expect(units).toBe(m * 7);
      expect(Number.isInteger(units)).toBe(true);
    }
  });

  it("an employee who becomes eligible mid-year accrues only from their first accrual month", () => {
    expect(accruedUnits("2026-03-10", "2026-12-15")).toBe(3 * 7);
    expect(accruedUnits("2026-03-10", "2026-09-30")).toBe(0);
  });

  it("resets on 1 January: last year's leaves and unspent days don't carry over", () => {
    const leaves = [annual("2026-03-02", "2026-03-06")];
    expect(balanceOf("2024-01-01", leaves, "2026-12-31")).toMatchObject({ accruedUnits: 84, usedDays: 5, balanceDays: 16 });
    expect(balanceOf("2024-01-01", leaves, "2027-01-01")).toMatchObject({ year: 2027, accruedUnits: 7, usedUnits: 0, balanceDays: 1.75 });
    // someone past the 6 months carries on accruing from January
    expect(accruedUnits("2026-03-10", "2027-03-20")).toBe(21);
  });
});

describe("which days a leave counts", () => {
  it("Thursday to Saturday is 3 days: the Friday between them counts", () => {
    // Thu 22 Oct, Fri 23 Oct, Sat 24 Oct
    expect(chargedLeaveDays("2026-10-22", "2026-10-24", kindOf).map((d) => d.day)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(requestDays("2026-10-22", "2026-10-24", kindOf)).toBe(3);
  });

  it("a Friday at the edge of the leave is not counted", () => {
    expect(requestDays("2026-10-22", "2026-10-23", kindOf)).toBe(1); // Thu, Fri
    expect(requestDays("2026-10-23", "2026-10-24", kindOf)).toBe(1); // Fri, Sat
  });

  it("a public holiday is never counted, even between leave days", () => {
    expect(requestDays("2026-10-20", "2026-10-22", kindOf)).toBe(2); // Tue, (Wed holiday), Thu
    // Tue 20 .. Sat 24: Tue, Thu, Fri (between Thu and Sat), Sat — not the Wednesday holiday
    expect(requestDays("2026-10-20", "2026-10-24", kindOf)).toBe(4);
  });

  it("a period that is nothing but a Friday or a holiday has no day to count", () => {
    expect(requestDays("2026-10-23", "2026-10-23", kindOf)).toBe(0);
    expect(requestDays("2026-10-21", "2026-10-21", kindOf)).toBe(0);
  });
});

describe("any absence takes from the balance first, then from pay", () => {
  const hire = "2024-01-01"; // 10 months by October = 17.5 days

  it("an absent day without leave is covered by the balance while a whole day is left", () => {
    const charges = leaveCharges({ hireDate: hire, leaves: [], absentDays: ["2026-10-05"], year: 2026, upTo: "2026-10-31", kindOf });
    expect(charges.get("2026-10-05")).toEqual({ coveredByBalance: true, sandwiched: false });
  });

  it("days are taken oldest first; once the balance is used up the rest fall to pay", () => {
    // hired 2026-01-01 -> first accrual 2026-07-01: by 2 July only 1.75 days exist
    const charges = leaveCharges({
      hireDate: "2026-01-01",
      leaves: [],
      absentDays: ["2026-07-02", "2026-07-06"],
      year: 2026,
      upTo: "2026-07-31",
      kindOf,
    });
    expect(charges.get("2026-07-02")!.coveredByBalance).toBe(true); // 1.75 -> 0.75 left
    expect(charges.get("2026-07-06")!.coveredByBalance).toBe(false); // 0.75 is not a whole day -> pay
    // next month's accrual (0.75 + 1.75 = 2.5) covers again
    const later = leaveCharges({ hireDate: "2026-01-01", leaves: [], absentDays: ["2026-07-02", "2026-07-06", "2026-08-03"], year: 2026, upTo: "2026-08-31", kindOf });
    expect(later.get("2026-08-03")!.coveredByBalance).toBe(true);
  });

  it("sick, casual, unpaid and annual leave all take from the same balance; a mission doesn't", () => {
    for (const type of ["sick", "casual", "unpaid", "annual", "excused_absence"]) {
      const charges = leaveCharges({ hireDate: hire, leaves: [{ type, status: "approved", from: "2026-10-05", to: "2026-10-05" }], absentDays: [], year: 2026, upTo: "2026-10-31", kindOf });
      expect(charges.get("2026-10-05")?.coveredByBalance).toBe(true);
    }
    const mission = leaveCharges({ hireDate: hire, leaves: [{ type: "mission", status: "approved", from: "2026-10-05", to: "2026-10-05" }], absentDays: [], year: 2026, upTo: "2026-10-31", kindOf });
    expect(mission.size).toBe(0);
  });

  it("the Friday inside a Thursday-to-Saturday leave is charged too, and marked as such", () => {
    const charges = leaveCharges({ hireDate: hire, leaves: [annual("2026-10-22", "2026-10-24")], absentDays: [], year: 2026, upTo: "2026-10-31", kindOf });
    expect(charges.get("2026-10-23")).toEqual({ coveredByBalance: true, sandwiched: true });
    expect(charges.size).toBe(3);
  });

  it("with no balance at all, a Thursday-to-Saturday leave is 3 days charged to pay", () => {
    // not yet 6 months: nothing accrued
    const charges = leaveCharges({ hireDate: "2026-06-01", leaves: [annual("2026-10-22", "2026-10-24")], absentDays: [], year: 2026, upTo: "2026-10-31", kindOf });
    expect([...charges.values()].every((c) => !c.coveredByBalance)).toBe(true);
    expect(charges.size).toBe(3);
  });

  it("an \"absent\" record on a Friday or a holiday takes nothing from the balance", () => {
    const charges = leaveCharges({ hireDate: hire, leaves: [], absentDays: ["2026-10-23", HOLIDAY], year: 2026, upTo: "2026-10-31", kindOf });
    expect(charges.size).toBe(0);
  });

  it("pending and rejected leaves don't settle anything; only approved ones and recorded absences do", () => {
    const charges = leaveCharges({
      hireDate: hire,
      leaves: [annual("2026-10-05", "2026-10-05", "pending"), annual("2026-10-06", "2026-10-06", "rejected")],
      absentDays: [],
      year: 2026,
      upTo: "2026-10-31",
      kindOf,
    });
    expect(charges.size).toBe(0);
  });

  it("the balance shows days charged to pay", () => {
    const b = balanceOf("2026-01-01", [], "2026-07-31", { absentDays: ["2026-07-02", "2026-07-06"], kindOf });
    expect(b).toMatchObject({ usedDays: 1, chargedToPayDays: 1, availableDays: 0 });
  });
});

describe("what is held against the balance", () => {
  const hire = "2024-01-01";

  it("pending leaves ahead are deducted; rejected ones are not", () => {
    const leaves = [annual("2026-11-02", "2026-11-03", "pending"), annual("2026-11-04", "2026-11-08", "rejected")];
    const b = balanceOf(hire, leaves, "2026-10-13", { kindOf });
    expect(b.accruedDays).toBe(17.5);
    expect(b.usedDays).toBe(2);
    expect(b.availableDays).toBe(15);
  });

  it("a recorded absence uses the balance like a leave does", () => {
    const b = balanceOf(hire, [], "2026-10-13", { absentDays: ["2026-10-05", "2026-10-06"], kindOf });
    expect(b.usedDays).toBe(2);
    expect(b.balanceDays).toBe(15.5);
  });
});

describe("filing an annual leave", () => {
  // 2026-10-13 12:00 local time; hired 2024-01-01 -> 17.5 days accrued, 17 available
  const now = new Date(2026, 9, 13, 12, 0, 0);
  const hire = "2024-01-01";
  const check = (over: Partial<Parameters<typeof checkAnnualLeaveRequest>[0]> = {}) =>
    checkAnnualLeaveRequest({ hireDate: hire, leaves: [], from: "2026-10-20", to: "2026-10-20", now, kindOf, ...over });

  it("accepts one whole day within the balance", () => {
    expect(check()).toMatchObject({ ok: true, days: 1, fromBalance: 1, fromPay: 0 });
  });

  it("rejects a half day (only whole days can be taken)", () => {
    expect(check({ days: 0.5 })).toMatchObject({ ok: false, reason: "invalid_days" });
    expect(check({ days: 1.5 })).toMatchObject({ ok: false, reason: "invalid_days" });
    expect(check({ from: "2026-10-22", to: "2026-10-20" })).toMatchObject({ ok: false, reason: "invalid_days" });
  });

  it("accepts more than the balance: what it covers comes from it, the rest is charged to pay", () => {
    // Sun 18 Oct .. Sat 14 Nov = 28 calendar days; its 4 Fridays all sit between leave days so they count,
    // the 21 Oct holiday doesn't -> 27 days, of which the balance covers 17
    expect(check({ from: "2026-10-18", to: "2026-11-14" })).toMatchObject({ ok: true, days: 27, fromBalance: 17, fromPay: 10 });
  });

  it("counts requests already on file, so the split moves as the balance is reserved", () => {
    // Sun 1 .. Thu 12 Nov is 12 days held (Fri 6 Nov sits between leave days) -> 17.5 - 12 = 5.5, 5 available
    const leaves = [annual("2026-11-01", "2026-11-12", "pending")];
    // Sun 25 .. Sat 31 Oct is 7 days (Fri 30 between): 5 from the balance, 2 charged to pay
    expect(check({ leaves, from: "2026-10-25", to: "2026-10-31" })).toMatchObject({ ok: true, days: 7, fromBalance: 5, fromPay: 2 });
  });

  it("needs 48 hours' notice: 36 hours before is refused, 60 hours before is fine, exactly 48 is enough", () => {
    expect(check({ from: "2026-10-15", to: "2026-10-15" })).toMatchObject({ ok: false, reason: "notice" });
    expect(check({ from: "2026-10-16", to: "2026-10-16", now: new Date(2026, 9, 13, 12) })).toMatchObject({ ok: false, reason: "no_working_days" }); // a Friday
    expect(check({ from: "2026-10-17", to: "2026-10-17" }).ok).toBe(true); // Sat, 84h away
    expect(check({ now: new Date(2026, 9, 13, 0, 0, 0), from: "2026-10-15", to: "2026-10-15" }).ok).toBe(true); // exactly 48h
  });

  it("refuses an employee who hasn't completed 6 months", () => {
    expect(check({ hireDate: "2026-06-01" })).toMatchObject({ ok: false, reason: "not_eligible" });
  });

  it("a period that is only a Friday or a holiday is refused with its own reason", () => {
    expect(check({ from: "2026-10-23", to: "2026-10-23" })).toMatchObject({ ok: false, reason: "no_working_days" });
    expect(check({ from: "2026-10-21", to: "2026-10-21" })).toMatchObject({ ok: false, reason: "no_working_days" });
  });

  it("a leave must sit inside the current year, because the balance resets on 1 January", () => {
    expect(check({ from: "2026-12-30", to: "2027-01-02" })).toMatchObject({ ok: false, reason: "other_year" });
  });
});
