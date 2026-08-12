import { describe, expect, it } from "vitest"
import {
  fallbackReviewerReport,
  normaliseReviewerReport,
} from "@/lib/reviewer-report"

describe("reviewer report helpers", () => {
  it("normalises a valid reviewer report", () => {
    const report = normaliseReviewerReport({
      applicant_bio: "Runs a small listening night.",
      advisory_recommendation: "recommend",
      confidence_score: 0.84,
      evidence_summary: ["Specific recurring participation"],
      weak_or_missing_signals: [],
      safety_or_integrity_flags: [],
      reviewer_focus: "Check contribution capacity.",
    })

    expect(report?.advisory_recommendation).toBe("recommend")
    expect(report?.confidence_score).toBe(0.84)
  })

  it("returns null for malformed reviewer reports", () => {
    expect(
      normaliseReviewerReport({
        applicant_bio: "Missing confidence.",
        advisory_recommendation: "recommend",
        reviewer_focus: "Read transcript.",
      }),
    ).toBeNull()
  })

  it("creates low-confidence fallback reports for terminal sessions", () => {
    const report = fallbackReviewerReport({
      terminalStatus: "passed",
      scores: { overall: 0.92 },
    })

    expect(report.advisory_recommendation).toBe("recommend")
    expect(report.confidence_score).toBe(0.6)
    expect(report.weak_or_missing_signals[0]).toContain("missing or malformed")
  })
})
