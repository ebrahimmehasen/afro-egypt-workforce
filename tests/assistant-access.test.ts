import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, canUseAssistant } from "@/lib/permissions";
import type { Role } from "@/lib/types";

describe("who may use the assistant", () => {
  it("is the admin, and only the admin", () => {
    expect(canUseAssistant({ role: "admin", permissions: [] })).toBe(true);
    expect(canUseAssistant({ role: "admin" })).toBe(true);
  });

  it.each<Role>(["hr", "supervisor", "staff"])("is never a %s account, even with every permission granted", (role) => {
    expect(canUseAssistant({ role, permissions: [...PERMISSION_KEYS] })).toBe(false);
    expect(canUseAssistant({ role, permissions: ["employees"] })).toBe(false);
    expect(canUseAssistant({ role, permissions: [] })).toBe(false);
  });

  it("is never an employee self-service account", () => {
    expect(canUseAssistant({ role: "employee", permissions: [] })).toBe(false);
    expect(canUseAssistant({ role: "employee", permissions: [...PERMISSION_KEYS] })).toBe(false);
  });
});
