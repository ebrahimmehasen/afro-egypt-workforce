import { describe, expect, it } from "vitest";
import { terminatedLast } from "@/lib/employee-order";
import type { EmployeeStatus } from "@/lib/types";

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
