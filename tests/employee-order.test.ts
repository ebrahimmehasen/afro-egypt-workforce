import { describe, expect, it } from "vitest";
import { ARCHIVE_AFTER_DAYS, isArchived, isManuallyArchived, terminatedLast } from "@/lib/employee-order";
import { employeesInScope, viewerScope } from "@/lib/scope";
import type { Employee, EmployeeStatus, User } from "@/lib/types";

const e = (id: string, status: EmployeeStatus) => ({ id, status });

describe("terminatedLast", () => {
  it("moves terminated employees to the end and keeps everyone else in their original order", () => {
    const list = [
      e("1", "terminated"),
      e("2", "active"),
      e("3", "on_leave"),
      e("4", "terminated"),
      e("5", "active"),
    ];
    const ids = [...list].sort(terminatedLast).map((x) => x.id);
    expect(ids).toEqual(["2", "3", "5", "1", "4"]);
  });

  it("only a terminated status moves a person — on leave stays among the active ones", () => {
    expect(terminatedLast(e("a", "on_leave"), e("b", "active"))).toBe(0);
  });

  it("treats an unresolved employee as not terminated, and can be chained ahead of a name sort", () => {
    expect(terminatedLast(undefined, e("a", "terminated"))).toBeLessThan(0);
    const rows = [e("z", "terminated"), e("b", "active"), e("a", "terminated"), e("c", "active")];
    const sorted = [...rows].sort((x, y) => terminatedLast(x, y) || x.id.localeCompare(y.id));
    expect(sorted.map((x) => x.id)).toEqual(["b", "c", "a", "z"]);
  });
});

describe("isArchived", () => {
  const NOW = new Date("2026-10-11T12:00:00.000Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it("an active employee is not archived", () => {
    expect(isArchived({ status: "active" }, NOW)).toBe(false);
  });

  it("terminated less than a month ago is not archived — they stay at the end of the main list", () => {
    expect(isArchived({ status: "terminated", terminatedAt: daysAgo(5) }, NOW)).toBe(false);
    expect(isArchived({ status: "terminated", terminatedAt: daysAgo(ARCHIVE_AFTER_DAYS - 1) }, NOW)).toBe(false);
  });

  it("terminated a month or more ago is archived (the 30th day is the first archived day)", () => {
    expect(isArchived({ status: "terminated", terminatedAt: daysAgo(ARCHIVE_AFTER_DAYS) }, NOW)).toBe(true);
    expect(isArchived({ status: "terminated", terminatedAt: daysAgo(400) }, NOW)).toBe(true);
  });

  it("archived by hand is archived, whatever the status", () => {
    const archivedAt = daysAgo(1);
    expect(isArchived({ status: "active", archivedAt }, NOW)).toBe(true);
    expect(isArchived({ status: "on_leave", archivedAt }, NOW)).toBe(true);
    expect(isArchived({ status: "terminated", terminatedAt: daysAgo(2), archivedAt }, NOW)).toBe(true);
    expect(isManuallyArchived({ archivedAt })).toBe(true);
    expect(isManuallyArchived({})).toBe(false);
  });

  it("going back to active takes an archived employee out of the archive", () => {
    // what the update action stores once the status leaves "terminated": terminatedAt and archivedAt cleared
    const before = { status: "terminated" as const, terminatedAt: daysAgo(90) };
    expect(isArchived(before, NOW)).toBe(true);
    const after = { status: "active" as const, terminatedAt: undefined, archivedAt: undefined };
    expect(isArchived(after, NOW)).toBe(false);
  });

  it("a terminated employee with no termination date can't be dated, so is not archived", () => {
    expect(isArchived({ status: "terminated" }, NOW)).toBe(false);
    expect(isArchived({ status: "terminated", terminatedAt: "not a date" }, NOW)).toBe(false);
  });

  it("is worked out from the clock: the same employee becomes archived as time passes", () => {
    const emp = { status: "terminated" as const, terminatedAt: daysAgo(10) };
    expect(isArchived(emp, NOW)).toBe(false);
    expect(isArchived(emp, new Date(NOW.getTime() + 21 * 24 * 60 * 60 * 1000))).toBe(true);
  });
});

describe("the archive respects the viewer's scope", () => {
  const NOW = new Date("2026-10-11T12:00:00.000Z");
  const longAgo = "2026-06-01T00:00:00.000Z";
  const emp = (id: string, departmentId: string, over: Partial<Employee> = {}): Employee => ({
    id,
    employeeNumber: id,
    name: id,
    departmentId,
    jobTitle: "worker",
    hireDate: "2025-01-01",
    shiftId: "SHIFT-1",
    salaryType: "monthly",
    basicSalary: 5000,
    dailyWorkingHours: 8,
    allowances: 0,
    status: "active",
    ...over,
  });
  const roster = [
    emp("A1", "D1"),
    emp("A2", "D1", { status: "terminated", terminatedAt: longAgo }),
    emp("A3", "D1", { archivedAt: longAgo }),
    emp("B1", "D2", { status: "terminated", terminatedAt: longAgo }),
    emp("B2", "D2"),
  ];
  const viewer = (over: Partial<User>): User => ({
    id: "U", name: "U", email: "u@x.com", role: "supervisor", permissions: ["employees"], ...over,
  });
  const archivedFor = (u: User) =>
    employeesInScope(viewerScope(u, roster), roster).filter((x) => isArchived(x, NOW)).map((x) => x.id);

  it("an admin sees every archived employee", () => {
    expect(archivedFor(viewer({ role: "admin" }))).toEqual(["A2", "A3", "B1"]);
  });

  it("a department supervisor sees only their own department's archived employees", () => {
    expect(archivedFor(viewer({ departmentIds: ["D1"] }))).toEqual(["A2", "A3"]);
    expect(archivedFor(viewer({ departmentIds: ["D2"] }))).toEqual(["B1"]);
  });
});
