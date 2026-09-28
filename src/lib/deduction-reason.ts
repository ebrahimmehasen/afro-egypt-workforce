// The list of deductions/penalties shows a short reason; the full text (with the calculation
// behind it) is only in the details popup. Nothing here touches what's stored — Deduction.reason
// keeps the full text the system (or a person) wrote; this only decides what the list displays.

/**
 * A short version of a deduction's reason for the list column. Every system-posted reason is a short
 * phrase followed by the measurement and calculation behind it — e.g. "تأخير 9.83 دقيقة × 1.5 = 14.75
 * دقيقة خصم" or "غياب بدون إذن مسبق — اليوم × 2" — so cutting at the first digit and trimming what's
 * left behind (a dash, a "×", stray spaces) leaves just the phrase ("تأخير", "غياب بدون إذن مسبق —
 * اليوم"). A reason with no digit at all — what a person types by hand, e.g. "تأخير" or "جزاء إداري" —
 * has nothing to cut and comes back exactly as it is. The one tradeoff: a hand-typed reason that
 * happens to include a number (a date, say) would also get cut at that number; the short list column
 * is only ever a preview anyway — the full text a person typed is still in the details popup.
 */
export function shortDeductionReason(reason: string): string {
  const m = reason.match(/\d/);
  if (!m || m.index === undefined) return reason;
  return reason.slice(0, m.index).replace(/[\s—×-]+$/, "").trim();
}
