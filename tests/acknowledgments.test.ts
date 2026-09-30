import { describe, expect, it } from "vitest";
import {
  CORE_REQUIRED_ACKNOWLEDGMENT_KEYS,
  acknowledgmentsComplete,
  canAcknowledgmentBeRequired,
  defaultRequiredAcknowledgmentKeys,
  isCustomAcknowledgmentKey,
  isStandardAcknowledgmentKey,
  missingAcknowledgmentKeys,
  parseRequiredAcknowledgments,
  requiredAcknowledgmentKeys,
  withAcknowledgmentRequirement,
} from "@/lib/acknowledgments";
import { EmployeeAcknowledgment } from "@/lib/types";

const ack = (key: string): EmployeeAcknowledgment => ({
  id: `a-${key}`,
  employeeId: "EMP-1",
  key,
  label: key,
  fileUrl: `/uploads/employees/EMP-1/acknowledgments/${key}-1.jpg`,
  uploadedAt: "2026-09-06T10:00:00.000Z",
});

describe("defaultRequiredAcknowledgmentKeys", () => {
  it("always asks for the core four signatures", () => {
    for (const k of CORE_REQUIRED_ACKNOWLEDGMENT_KEYS) {
      expect(defaultRequiredAcknowledgmentKeys({})).toContain(k);
    }
  });

  it("never defaults custody_receipt or confidentiality into required", () => {
    const required = defaultRequiredAcknowledgmentKeys({ isDriver: true });
    expect(required).not.toContain("custody_receipt");
    expect(required).not.toContain("confidentiality");
  });

  it("asks for the vehicle-receipt acknowledgment only from a driver", () => {
    expect(defaultRequiredAcknowledgmentKeys({ isDriver: true })).toContain("vehicle_receipt");
    expect(defaultRequiredAcknowledgmentKeys({ isDriver: false })).not.toContain("vehicle_receipt");
    expect(defaultRequiredAcknowledgmentKeys({})).not.toContain("vehicle_receipt");
  });
});

describe("missingAcknowledgmentKeys / acknowledgmentsComplete", () => {
  it("lists every required key when nothing is signed", () => {
    const required = defaultRequiredAcknowledgmentKeys({});
    expect(missingAcknowledgmentKeys([], required)).toEqual(required);
    expect(acknowledgmentsComplete([], required)).toBe(false);
  });

  it("is complete once every required key is on file", () => {
    const required = defaultRequiredAcknowledgmentKeys({ isDriver: true });
    const all = required.map(ack);
    expect(missingAcknowledgmentKeys(all, required)).toEqual([]);
    expect(acknowledgmentsComplete(all, required)).toBe(true);
  });

  it("never demands a non-required standard key or a custom one", () => {
    const required = defaultRequiredAcknowledgmentKeys({});
    expect(missingAcknowledgmentKeys([], required)).not.toContain("custody_receipt");
    expect(missingAcknowledgmentKeys([], required)).not.toContain("confidentiality");
  });
});

describe("per-employee required acknowledgments", () => {
  it("falls back to the computed default until a custom list is set", () => {
    expect(requiredAcknowledgmentKeys({})).toEqual(defaultRequiredAcknowledgmentKeys({}));
    expect(requiredAcknowledgmentKeys({ requiredAcknowledgments: ["custody_receipt"] })).toEqual(["custody_receipt"]);
  });

  it("moves a key into and out of the required list, clearing the override at the employee's own default", () => {
    const defaults = defaultRequiredAcknowledgmentKeys({});
    const withCustody = withAcknowledgmentRequirement(defaults, "custody_receipt", true, defaults);
    expect(withCustody).toContain("custody_receipt");
    const backToDefault = withAcknowledgmentRequirement(withCustody!, "custody_receipt", false, defaults);
    expect(backToDefault).toBeNull();
  });

  it("parses stored JSON defensively, dropping unknown keys", () => {
    expect(parseRequiredAcknowledgments(null)).toBeUndefined();
    expect(parseRequiredAcknowledgments("nope")).toBeUndefined();
    expect(parseRequiredAcknowledgments(["custody_receipt", "made_up"])).toEqual(["custody_receipt"]);
  });
});

describe("key classification", () => {
  it("only standard keys can be made required", () => {
    expect(canAcknowledgmentBeRequired("employment_terms")).toBe(true);
    expect(canAcknowledgmentBeRequired("custom-abc123")).toBe(false);
  });

  it("recognizes custom slots by their prefix", () => {
    expect(isStandardAcknowledgmentKey("internal_bylaws")).toBe(true);
    expect(isCustomAcknowledgmentKey("custom-abc123")).toBe(true);
    expect(isCustomAcknowledgmentKey("internal_bylaws")).toBe(false);
  });
});
