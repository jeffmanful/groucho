import type { ReviewerReport } from "@/lib/reviewer-report"

/**
 * Suitability for the newer COLORS conversation engine, which does not score turns.
 *
 * The private reviewer report's recommendation sets the range and its confidence places the
 * applicant inside it, so the order is always decline < human_review < recommend:
 *
 * | Recommendation | Score                | With the default thresholds (0.80 / 0.55)           |
 * | -------------- | -------------------- | --------------------------------------------------- |
 * | recommend      | 0.60 + 0.30 × conf   | conf ≥ 0.67 → recommended_acceptance, else review   |
 * | human_review   | 0.55 + 0.05 × conf   | always review: never automatically accepted/declined |
 * | decline        | 0.45 × (1 − conf)    | always below_threshold                              |
 *
 * Thin but positive evidence (reports near 0.5 confidence) therefore stays in the review band,
 * while well-evidenced recommendations reach the acceptance band. Projects that move their
 * thresholds move these bands with them.
 */
export const COLORS_SUITABILITY_RANGES = {
  recommend: { base: 0.6, span: 0.3 },
  human_review: { base: 0.55, span: 0.05 },
} as const

export const COLORS_DECLINE_CEILING = 0.45

function round(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
}

/** Returns null when the report has no usable recommendation or confidence. */
export function suitabilityFromReviewerReport(
  report: Pick<ReviewerReport, "advisory_recommendation" | "confidence_score"> | null | undefined,
): number | null {
  if (!report) return null
  const confidence = report.confidence_score
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null
  const c = Math.max(0, Math.min(1, confidence))
  switch (report.advisory_recommendation) {
    case "recommend":
      return round(COLORS_SUITABILITY_RANGES.recommend.base + COLORS_SUITABILITY_RANGES.recommend.span * c)
    case "human_review":
      return round(COLORS_SUITABILITY_RANGES.human_review.base + COLORS_SUITABILITY_RANGES.human_review.span * c)
    case "decline":
      return round(COLORS_DECLINE_CEILING * (1 - c))
    default:
      return null
  }
}

/**
 * The legacy PASS / REDIRECT / REJECT value that verdict rows and webhook payloads still require.
 * It mirrors the advisory recommendation only; access is decided by reviewStatus.
 */
export function compatibilityOutcomeFromReport(
  report: Pick<ReviewerReport, "advisory_recommendation"> | null | undefined,
): "PASS" | "REDIRECT" | "REJECT" {
  if (report?.advisory_recommendation === "recommend") return "PASS"
  if (report?.advisory_recommendation === "decline") return "REJECT"
  return "REDIRECT"
}

/**
 * Keep each recommendation in its intended band whatever thresholds a project sets: a
 * human-review report always lands in the review band (never automatically accepted or
 * declined), and a decline always lands below the review threshold. Recommend is unchanged, so
 * its confidence still decides between review and recommended acceptance.
 */
export function alignSuitabilityWithPolicy(
  score: number,
  recommendation: ReviewerReport["advisory_recommendation"],
  policy: { acceptanceThreshold: number; reviewThreshold: number },
): number {
  const justBelow = (threshold: number) => Math.max(0, Math.round((threshold - 0.001) * 1000) / 1000)
  if (recommendation === "human_review") {
    return Math.min(Math.max(score, policy.reviewThreshold), justBelow(policy.acceptanceThreshold))
  }
  if (recommendation === "decline") return Math.min(score, justBelow(policy.reviewThreshold))
  return score
}
