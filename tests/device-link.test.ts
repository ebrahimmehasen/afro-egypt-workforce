import { describe, expect, it } from "vitest";
import { deviceLink, deviceUserNames } from "@/lib/device-link";

const names = { "7": "MOHAMED A", "8": "  ", "9": " SARA " };

describe("deviceLink", () => {
  it("says not linked when the employee has no device user", () => {
    expect(deviceLink(undefined, names)).toEqual({ state: "not_linked" });
    expect(deviceLink(null, names)).toEqual({ state: "not_linked" });
    expect(deviceLink("   ", names)).toEqual({ state: "not_linked" });
  });

  it("gives the name the device itself holds, trimmed", () => {
    expect(deviceLink("7", names)).toEqual({ state: "named", deviceUserId: "7", name: "MOHAMED A" });
    expect(deviceLink(" 9 ", names)).toEqual({ state: "named", deviceUserId: "9", name: "SARA" });
  });

  it("only says the link is there while the device's names aren't available", () => {
    expect(deviceLink("7", null)).toEqual({ state: "unknown", deviceUserId: "7" });
  });

  it("treats a blank name on the device as no name rather than an empty cell", () => {
    expect(deviceLink("8", names)).toEqual({ state: "unknown", deviceUserId: "8" });
  });

  it("flags a link whose device user no longer exists", () => {
    expect(deviceLink("42", names)).toEqual({ state: "missing", deviceUserId: "42" });
  });
});

describe("deviceUserNames", () => {
  it("keys the device's users by the device's own user id", () => {
    expect(deviceUserNames([{ userId: "1", name: "A" }, { userId: "2", name: "B" }])).toEqual({ "1": "A", "2": "B" });
    expect(deviceUserNames([])).toEqual({});
  });
});
