import { describe, expect, it } from "vitest"
import { alignSuitabilityWithPolicy, compatibilityOutcomeFromReport, suitabilityFromReviewerReport } from "@/lib/colors-suitability"
import { DEFAULT_CLIENT_DECISION_POLICY, suitabilityBand } from "@/lib/decision-policy"

const score = (advisory_recommendation: "recommend" | "human_review" | "decline", confidence_score: number) =>
  suitabilityFromReviewerReport({ advisory_recommendation, confidence_score }) as number

describe("COLORS suitability from the reviewer report", () => {
  it("maps each recommendation into its own range", () => {
    expect(score("recommend", 0)).toBe(0.6)
    expect(score("recommend", 1)).toBe(0.9)
    expect(score("human_review", 0)).toBe(0.55)
    expect(score("human_review", 1)).toBe(0.6)
    expect(score("decline", 0)).toBe(0.45)
    expect(score("decline", 1)).toBe(0)
  })

  it("always orders decline below human review below recommend", () => {
    for (const c of [0, 0.25, 0.5, 0.75, 1]) {
      for (const other of [0, 0.25, 0.5, 0.75, 1]) {
        expect(score("decline", c)).toBeLessThan(score("human_review", other))
        expect(score("human_review", c)).toBeLessThanOrEqual(score("recommend", other))
      }
    }
  })

  it("keeps thin positive evidence in review and strong evidence in the acceptance band", () => {
    const band = (value: number) => suitabilityBand(value, DEFAULT_CLIENT_DECISION_POLICY)
    expect(band(score("recommend", 0.5))).toBe("review")
    expect(band(score("recommend", 0.6))).toBe("review")
    expect(band(score("recommend", 0.78))).toBe("recommended_acceptance")
    for (const c of [0, 0.5, 1]) expect(band(score("human_review", c))).toBe("review")
    for (const c of [0, 0.5, 1]) expect(band(score("decline", c))).toBe("below_threshold")
  })

  it("returns null without a usable report", () => {
    expect(suitabilityFromReviewerReport(null)).toBeNull()
    expect(suitabilityFromReviewerReport({ advisory_recommendation: "recommend", confidence_score: Number.NaN })).toBeNull()
  })

  it("clamps confidence outside 0 to 1", () => {
    expect(score("recommend", 3)).toBe(0.9)
    expect(score("recommend", -1)).toBe(0.6)
  })

  it("derives the legacy verdict outcome from the recommendation only", () => {
    expect(compatibilityOutcomeFromReport({ advisory_recommendation: "recommend" })).toBe("PASS")
    expect(compatibilityOutcomeFromReport({ advisory_recommendation: "human_review" })).toBe("REDIRECT")
    expect(compatibilityOutcomeFromReport({ advisory_recommendation: "decline" })).toBe("REJECT")
    expect(compatibilityOutcomeFromReport(null)).toBe("REDIRECT")
  })

  it("keeps human review and decline in their bands under any project thresholds", () => {
    const lenient = { acceptanceThreshold: 0.6, reviewThreshold: 0.3 }
    const strict = { acceptanceThreshold: 0.95, reviewThreshold: 0.7 }
    for (const policy of [lenient, strict, { acceptanceThreshold: 0.8, reviewThreshold: 0.55 }]) {
      const band = (value: number) => suitabilityBand(value, { ...DEFAULT_CLIENT_DECISION_POLICY, ...policy })
      for (const c of [0, 0.5, 1]) {
        expect(band(alignSuitabilityWithPolicy(score("human_review", c), "human_review", policy))).toBe("review")
        expect(band(alignSuitabilityWithPolicy(score("decline", c), "decline", policy))).toBe("below_threshold")
      }
      expect(alignSuitabilityWithPolicy(0.834, "recommend", policy)).toBe(0.834)
    }
  })
})
