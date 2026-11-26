import type { ReviewReason } from "@/lib/missing-punch-review";

// Pure on purpose: the attendance table is a client component and must not import the server-side review module for a value.
/** The label for each reason, one place for the bell and the attendance table so a reason never reads as another. */
export const reviewReasonLabel = (
  n: { punchReviewMissing: string; punchReviewOdd: string; punchReviewPermission: string; punchReviewNoReturn: string },
  reason: ReviewReason,
): string => ({ missing_punch: n.punchReviewMissing, odd_punches: n.punchReviewOdd, permission_unused: n.punchReviewPermission, permission_no_return: n.punchReviewNoReturn })[reason];
