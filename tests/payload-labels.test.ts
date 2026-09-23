import { describe, expect, it } from "vitest";
import { isHiddenPayloadField, payloadRows, payloadValueText } from "@/lib/i18n/payload-labels";
import { ar } from "@/lib/i18n/dictionaries/ar";

describe("a change request's data, made readable", () => {
  it("labels each field and leaves internal references out", () => {
    const rows = payloadRows(
      { id: "EMP-1", departmentId: "d1", name: "سامي", basicSalary: 6000, salaryType: "daily", nationalId: "29001010101010" },
      ar,
    );
    expect(rows.map((r) => r.label)).toEqual([ar.employees.formName, ar.employees.formBasicSalary, ar.employees.formSalaryType, ar.employees.formNationalId]);
    expect(rows.find((r) => r.label === ar.employees.formSalaryType)!.value).toBe(ar.employees.salaryDaily);
  });

  it("hides ids, whatever they are called", () => {
    for (const key of ["id", "employeeId", "periodId", "payTypeId", "someOtherId"]) expect(isHiddenPayloadField(key)).toBe(true);
    // but the national ID is real information, not a record reference
    expect(isHiddenPayloadField("nationalId")).toBe(false);
    expect(isHiddenPayloadField("name")).toBe(false);
  });

  it("writes stored codes as words, and says nothing for an empty value", () => {
    expect(payloadValueText("type", "unauthorized_exit", ar)).toBe(ar.deductionTypes.unauthorizedExit);
    expect(payloadValueText("status", "terminated", ar)).toBe(ar.employees.statusTerminated);
    expect(payloadValueText("decision", "approved", ar)).toBe(ar.statuses.approved);
    expect(payloadValueText("reason", "", ar)).toBe("—");
    expect(payloadValueText("amount", 150, ar)).toBe("150");
  });

  it("has nothing to show for a request that carries no data", () => {
    expect(payloadRows(null, ar)).toEqual([]);
    expect(payloadRows({ id: "x" }, ar)).toEqual([]);
  });
});
