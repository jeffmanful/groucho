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
  snapshot: {
    applicant_summary: "Hosts a recurring listening table and could bring practical experience of convening focused discussion.",
    evidence_reference_ids: ["answer-1"],
    tags: [{
      value: "community_participation",
      evidence_reference_ids: ["answer-1"],
    }],
  },
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
  curatorial_approach: {
    present: false,
    summary: "",
    evidence_reference_ids: [],
    observed_dimensions: [],
  },
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
    expect(report.detailed_opinion?.snapshot?.tags[0]?.value).toBe(
      "community_participation",
    )
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

  it("synthesises media-choice reasoning without treating the selected artist as a score", async () => {
    const curationReport: ReviewerReport = {
      ...baseReport,
      evidence_references: [{
        signal_key: "conversation_context",
        signal_label: "Curation exercise",
        source_message_id: "curation-answer",
        excerpt: "Removed Performance B because the remaining set creates a gradual arc.",
        interaction: {
          type: "mediaChoice",
          question_id: "programme-room",
          mode: "remove",
          selected_options: [{ id: "performance-b", label: "Performance B" }],
          rationale: "The remaining set creates a gradual arc.",
        },
      }],
    }
    const curationEvaluation = {
      ...evaluation,
      curatorial_approach: {
        present: true,
        summary: "Frames the programme through gradual emotional change.",
        evidence_reference_ids: ["curation-answer"],
        observed_dimensions: ["coherence", "audience_awareness"],
      },
      claim_assessments: [{
        claim: "The applicant considered the programme arc.",
        evidence_reference_ids: ["curation-answer"],
        interpretation: "The rationale describes coherence rather than artist preference.",
        assessment: "context",
      }],
    }
    createMock
      .mockResolvedValueOnce(response(curationEvaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{
        id: "curation-answer",
        role: "user",
        content: curationReport.evidence_references[0].excerpt,
      }],
      baseReport: curationReport,
    })

    expect(report.detailed_opinion?.curatorial_approach).toEqual(
      curationEvaluation.curatorial_approach,
    )
    expect(JSON.stringify(createMock.mock.calls[0]?.[0]?.messages)).toContain(
      "selected_options",
    )
    expect(createMock.mock.calls[0]?.[0]?.system).toContain(
      "Audience size, reach, follower count",
    )
    expect(createMock.mock.calls[1]?.[0]?.system).toContain(
      "particular artist as inherently positive or negative",
    )
    expect(createMock.mock.calls[1]?.[0]?.system).toContain(
      "snapshot summary and every tag",
    )
    expect(JSON.stringify(createMock.mock.calls[1]?.[0]?.messages)).toContain(
      "evidenceReferences",
    )
  })
})
