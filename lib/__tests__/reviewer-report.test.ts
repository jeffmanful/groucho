import { describe, expect, it } from "vitest"
import {
  ensureEvidenceBackedReviewerReport,
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
    expect(report?.evidence_references).toEqual([])
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
    expect(report.evidence_references).toEqual([])
  })

  it("builds a reviewable report from persisted signal evidence", () => {
    const definitions = [
      {
        key: "participation",
        label: "How do you participate?",
        goal: "Understand participation.",
        promptRoutes: [],
        priority: "core" as const,
        cluster: "participation",
        audiences: ["shared" as const],
      },
      {
        key: "contribution",
        label: "What would you contribute?",
        goal: "Understand contribution.",
        promptRoutes: [],
        priority: "core" as const,
        cluster: "contribution",
        audiences: ["shared" as const],
      },
    ]
    const report = ensureEvidenceBackedReviewerReport({
      report: null,
      terminalStatus: "redirected",
      scores: { overall: 0.58 },
      definitions,
      answers: [
        {
          ...definitions[0],
          answer: "I host a monthly listening night.",
          covered: true,
          sources: [
            {
              messageId: "message-participation",
              excerpt: "I host a monthly listening night.",
            },
          ],
        },
        { ...definitions[1], answer: "Not sure.\nFollow-up: I don't know.", covered: false },
      ],
      insufficientEvidenceKeys: new Set(["contribution"]),
      orientation: {
        primary: "curator",
        scores: { artist: 0.1, curator: 0.84, enthusiast: 0.3 },
        confidence: 0.84,
        evidence: ["Hosts a listening night"],
      },
    })

    expect(report.advisory_recommendation).toBe("human_review")
    expect(report.applicant_bio).toContain("curator")
    expect(report.evidence_summary).toEqual([
      "How do you participate?: I host a monthly listening night.",
    ])
    expect(report.evidence_references).toEqual([
      {
        signal_key: "participation",
        signal_label: "How do you participate?",
        source_message_id: "message-participation",
        excerpt: "I host a monthly listening night.",
      },
    ])
    expect(report.weak_or_missing_signals[0]).toContain("insufficient evidence")
  })

  it("replaces untraceable model evidence with persisted application evidence", () => {
    const definition = {
      key: "participation",
      label: "Participation",
      goal: "Understand participation.",
      promptRoutes: [],
      priority: "core" as const,
      cluster: "participation",
      audiences: ["shared" as const],
    }
    const report = ensureEvidenceBackedReviewerReport({
      report: normaliseReviewerReport({
        applicant_bio: "Applicant bio.",
        advisory_recommendation: "recommend",
        confidence_score: 0.9,
        evidence_summary: ["Unsupported model claim"],
        weak_or_missing_signals: [],
        safety_or_integrity_flags: [],
        reviewer_focus: "Review the evidence.",
      }),
      terminalStatus: "passed",
      scores: { overall: 0.8 },
      definitions: [definition],
      answers: [
        {
          ...definition,
          answer: "I host a monthly listening night.",
          covered: true,
          sources: [{
            messageId: "message-1",
            excerpt: "I host a monthly listening night.",
          }],
        },
      ],
    })

    expect(report.evidence_summary).toEqual([
      "Participation: I host a monthly listening night.",
    ])
    expect(report.evidence_summary).not.toContain("Unsupported model claim")
    expect(report.evidence_references[0]?.source_message_id).toBe("message-1")
  })

  it("preserves deterministic integrity flags when the model omits them", () => {
    const report = ensureEvidenceBackedReviewerReport({
      report: normaliseReviewerReport({
        applicant_bio: "Applicant bio.",
        advisory_recommendation: "human_review",
        confidence_score: 0.6,
        evidence_summary: [],
        weak_or_missing_signals: [],
        safety_or_integrity_flags: [],
        reviewer_focus: "Review the concern.",
      }),
      terminalStatus: "redirected",
      scores: { overall: 0.5 },
      definitions: [],
      answers: [],
      integrityFlags: [
        "Applicant described sharing private artist work without permission.",
      ],
    })

    expect(report.safety_or_integrity_flags).toContain(
      "Applicant described sharing private artist work without permission.",
    )
  })
})
