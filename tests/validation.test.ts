import { describe, expect, it } from "vitest";
import { z } from "zod";
import { invalidFieldsError } from "@/lib/validation";
import { ar } from "@/lib/i18n/dictionaries/ar";

describe("invalidFieldsError", () => {
  const schema = z.object({ phone: z.string().min(6), nationalId: z.string().regex(/^\d{14}$/), name: z.string().min(2) });

  it("names every failing field with its reason and reports the field ids", () => {
    const r = schema.safeParse({ phone: "12", nationalId: "123", name: "Ali" });
    if (r.success) throw new Error("should fail");
    const res = invalidFieldsError(ar, r.error.issues);
    expect(res.fields).toEqual(["phone", "nationalId"]);
    expect(res.error).toContain(ar.validation.fieldProblems.phone);
    expect(res.error).toContain(ar.validation.fieldProblems.nationalId);
    expect(res.error).not.toContain(ar.validation.fieldProblems.name);
  });

  it("remaps a rule reported on one path to the input the user should fix", () => {
    const res = invalidFieldsError(ar, [{ path: ["salaryType"] } as never], (f) => (f === "salaryType" ? "basicSalary" : f));
    expect(res.fields).toEqual(["basicSalary"]);
  });
});
