import { describe, expect, it } from "vitest"
import { adminSessionReviewerReport } from "@/lib/admin-session-report"

const baseReport = {
  applicant_bio: "Applicant hosts a listening session.",
  advisory_recommendation: "recommend",
  confidence_score: 0.75,
  evidence_summary: ["Hosts a monthly listening session."],
  evidence_references: [{
    signal_key: "contribution",
    signal_label: "Contribution",
    source_message_id: "answer-1",
    excerpt: "I host a monthly listening session.",
  }],
  weak_or_missing_signals: [],
  safety_or_integrity_flags: [],
  reviewer_focus: "Discuss the applicant's listening practice.",
}

const detailedReport = {
  ...baseReport,
  confidence_score: 0.78,
  detailed_opinion: {
    advisory_reason: "The applicant describes a sustained listening practice.",
    advisory_evidence_reference_ids: ["answer-1"],
    overall_assessment: "A grounded applicant.",
    decisive_reasons: ["Monthly listening practice."],
    claim_assessments: [{
      claim: "Hosts a monthly listening session.",
      evidence_reference_ids: ["answer-1"],
      interpretation: "Shows practical contribution.",
      assessment: "strength",
    }],
    likely_contribution: "Could host a focused listening session.",
    reservations: [],
    reviewer_questions: [],
    suggested_human_action: "approve",
  },
}

describe("admin session report selection", () => {
  it("shows the later detailed message report instead of the completion verdict", () => {
    const report = adminSessionReviewerReport([
      { role: "user", metadata: null },
      { role: "assistant", metadata: { reviewer_report: detailedReport } },
    ], baseReport)

    expect(report?.detailed_opinion?.overall_assessment).toBe("A grounded applicant.")
    expect(report?.confidence_score).toBe(0.78)
  })

  it("falls back to the verdict when the transcript has no report", () => {
    expect(adminSessionReviewerReport([
      { role: "assistant", metadata: {} },
    ], baseReport)?.applicant_bio).toBe(baseReport.applicant_bio)
  })

  it("ignores malformed message metadata without losing a valid report", () => {
    const report = adminSessionReviewerReport([
      { role: "assistant", metadata: { reviewer_report: detailedReport } },
      { role: "assistant", metadata: { reviewer_report: { nonsense: true } } },
    ], null)
    expect(report?.detailed_opinion?.suggested_human_action).toBe("approve")
  })
})
