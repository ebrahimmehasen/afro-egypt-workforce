import { describe, expect, it } from "vitest";
import { shortDeductionReason } from "@/lib/deduction-reason";

describe("shortDeductionReason", () => {
  it("keeps only what's before the calculation for a system-posted reason", () => {
    expect(shortDeductionReason("تأخير 9.83 دقيقة × 1.5 = 14.75 دقيقة خصم")).toBe("تأخير");
    expect(shortDeductionReason("إذن لباقي اليوم 1.27 ساعة × 1")).toBe("إذن لباقي اليوم");
    expect(shortDeductionReason("خروج بدون إذن 1.27 ساعة × 1.5")).toBe("خروج بدون إذن");
  });

  it("drops a trailing dash left behind once the number after it is gone", () => {
    expect(shortDeductionReason("غياب بدون إذن مسبق — اليوم × 2")).toBe("غياب بدون إذن مسبق — اليوم");
    expect(shortDeductionReason("غياب بإذن معتمد مسبقاً — اليوم × 1")).toBe("غياب بإذن معتمد مسبقاً — اليوم");
  });

  it("leaves a hand-typed reason with no number in it exactly as it is", () => {
    expect(shortDeductionReason("تأخير")).toBe("تأخير");
    expect(shortDeductionReason("غياب بدون سبب")).toBe("غياب بدون سبب");
    expect(shortDeductionReason("جزاء إداري")).toBe("جزاء إداري");
  });

  it("also shortens a hand-typed reason at the first number, the one accepted tradeoff", () => {
    expect(shortDeductionReason("غياب يوم 15/9 بدون عذر")).toBe("غياب يوم");
  });
});
