// Every limit of the employee-evaluation tool lives here, in one place. No pay number, salary range or hardcoded
// rating/level label lives anywhere in this feature — job levels and the rating scale are both read from the
// database rows an admin creates in Settings.

export const EVALUATION_LIMITS = {
  maxJobLevelNameLength: 80,
  maxRatingLabelLength: 80,
  maxLevelChangeReasonLength: 2000,
  maxEvaluationPeriodLabelLength: 60,
  maxEvaluationCommentLength: 2000,
  /** Settings lists (job levels, rating scale items) — generous, never meant to bind in practice. */
  maxSortOrder: 9999,
} as const;
