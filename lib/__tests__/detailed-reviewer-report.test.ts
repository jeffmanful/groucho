import { beforeEach, describe, expect, it, vi } from "vitest"

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock }
  },
}))

import { generateDetailedReviewerReport } from "@/lib/detailed-reviewer-report"
import type { ReviewerReport } from "@/lib/reviewer-report"

const baseReport: ReviewerReport = {
  applicant_bio: "Applicant shared one established evidence area.",
  advisory_recommendation: "human_review",
  confidence_score: 0.6,
  evidence_summary: ["Participation: I host a listening table."],
  evidence_references: [{
    signal_key: "participation",
    signal_label: "Participation",
    source_message_id: "answer-1",
    excerpt: "I host a listening table.",
  }],
  weak_or_missing_signals: [],
  safety_or_integrity_flags: [],
  reviewer_focus: "Review the evidence.",
}

const evaluation = {
  applicant_bio: "Hosts a listening table.",
  advisory_recommendation: "recommend",
  confidence_score: 0.8,
  overall_assessment: "Concrete recurring participation.",
  decisive_reasons: ["Hosts a listening table."],
  claim_assessments: [{
    claim: "Hosts a listening table.",
    evidence_reference_ids: ["answer-1"],
    interpretation: "This is an established practice.",
    assessment: "strength",
  }],
  likely_contribution: "Could convene focused listening discussions.",
  reservations: [],
  reviewer_questions: [],
  suggested_human_action: "approve",
}

function response(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    stop_reason: "end_turn",
    usage: {},
  }
}

describe("detailed reviewer report verification", () => {
  beforeEach(() => createMock.mockReset())

  it("returns a source-linked report after semantic verification", async () => {
    createMock
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport,
    })

    expect(report.detailed_opinion?.suggested_human_action).toBe("approve")
    expect(createMock).toHaveBeenCalledTimes(2)
  })

  it("rejects a draft that the semantic verifier finds unsupported", async () => {
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        applicant_bio: "A music-industry director.",
      }))
      .mockResolvedValueOnce(response({
        supported: false,
        issues: ["The professional title is not supported by the transcript."],
      }))

    await expect(generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I help with partnerships." }],
      baseReport,
    })).rejects.toThrow("professional title")
  })
})
