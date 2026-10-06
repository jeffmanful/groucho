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
  advisory_reason: "The applicant describes an established listening practice.",
  advisory_evidence_reference_ids: ["answer-1"],
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
      terminalStatus: "passed",
    })

    expect(report.detailed_opinion?.suggested_human_action).toBe("approve")
    expect(report.detailed_opinion?.snapshot?.tags[0]?.value).toBe(
      "community_participation",
    )
    expect(createMock).toHaveBeenCalledTimes(2)
    expect(report.detailed_opinion?.advisory_reason).toContain("established listening practice")
    const writerInput = String(createMock.mock.calls[0]?.[0]?.messages?.[0]?.content)
    expect(writerInput).toContain('"terminalStatus":"passed"')
    expect(writerInput).toContain('"preliminaryAdvisory":"human_review"')
    const writerSystem = String((createMock.mock.calls[0]?.[0] as { system?: unknown })?.system)
    const verifierSystem = String((createMock.mock.calls[1]?.[0] as { system?: unknown })?.system)
    for (const instructions of [writerSystem, verifierSystem]) {
      expect(instructions).toContain("does not establish an order")
      expect(instructions).toContain("not the same as asking permission")
      expect(instructions).toContain("requests for Groucho to clarify")
    }
  })

  it("keeps routine follow-up questions from downgrading a passed, positive application", async () => {
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        advisory_recommendation: "human_review",
        confidence_score: 0.68,
        advisory_reason: "The existing practice has not been independently observed.",
        advisory_evidence_reference_ids: [],
        reviewer_questions: ["How does the listening table operate?"],
        suggested_human_action: "discuss",
      }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport: { ...baseReport, advisory_recommendation: "recommend" },
      terminalStatus: "passed",
    })

    expect(report.advisory_recommendation).toBe("recommend")
    expect(report.confidence_score).toBe(0.68)
    expect(report.detailed_opinion?.reviewer_questions).toEqual([
      "How does the listening table operate?",
    ])
    expect(report.detailed_opinion?.advisory_reason).toBe("This is an established practice.")
    const verifierInput = String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content)
    expect(verifierInput).toContain('"advisory_recommendation":"recommend"')
  })

  it("allows a source-backed concern to override a passed preliminary recommendation", async () => {
    const concernReport = {
      ...baseReport,
      advisory_recommendation: "recommend" as const,
      evidence_references: [{
        ...baseReport.evidence_references[0],
        excerpt: "I dismiss listeners who disagree with my choices.",
      }],
    }
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        advisory_recommendation: "human_review",
        advisory_reason: "The applicant describes dismissing listeners who disagree.",
        advisory_evidence_reference_ids: [],
        claim_assessments: [{
          claim: "Dismisses listeners who disagree with their choices.",
          evidence_reference_ids: ["answer-1"],
          interpretation: "This raises a specific concern about collaborative listening.",
          assessment: "concern",
        }],
        reservations: [{
          text: "The stated approach to disagreement needs review.",
          evidence_reference_ids: ["answer-1"],
        }],
        suggested_human_action: "discuss",
      }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{
        id: "answer-1",
        role: "user",
        content: "I dismiss listeners who disagree with my choices.",
      }],
      baseReport: concernReport,
      terminalStatus: "passed",
    })

    expect(report.advisory_recommendation).toBe("human_review")
    expect(report.detailed_opinion?.advisory_evidence_reference_ids).toEqual(["answer-1"])
    expect(report.detailed_opinion?.advisory_reason).toBe(
      "This raises a specific concern about collaborative listening.",
    )
  })

  it("repairs a rejected draft once and still fails if the correction is unsupported", async () => {
    const unsupported = { ...evaluation, applicant_bio: "A music-industry director." }
    const rejected = {
      supported: false,
      issues: ["The professional title is not supported by the transcript."],
    }
    createMock
      .mockResolvedValueOnce(response(unsupported))
      .mockResolvedValueOnce(response(rejected))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const input = {
      transcript: [{ id: "answer-1", role: "user" as const, content: "I host a listening table." }],
      baseReport,
    }
    const repaired = await generateDetailedReviewerReport(input)
    expect(repaired.applicant_bio).toBe("Hosts a listening table.")
    expect(createMock).toHaveBeenCalledTimes(4)
    expect(String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content))
      .toContain("professional title is not supported")

    createMock.mockReset()
    createMock
      .mockResolvedValueOnce(response(unsupported))
      .mockResolvedValueOnce(response(rejected))
      .mockResolvedValueOnce(response(unsupported))
      .mockResolvedValueOnce(response(rejected))

    await expect(generateDetailedReviewerReport(input)).rejects.toThrow("professional title")
    expect(createMock).toHaveBeenCalledTimes(4)
  })

  it("accepts only evidence-linked reservations and excludes process feedback from review", async () => {
    const facts = {
      version: 1 as const,
      mediaChoice: null,
      processFeedback: [{ kind: "requests_topic_change" as const, sourceMessageId: "process-turn" }],
    }
    const transcript = [
      { id: "answer-1", role: "user" as const, content: "I host a listening table." },
      { id: "process-turn", role: "user" as const, content: "Can we move on?" },
      { id: "groucho-reply", role: "assistant" as const, content: "Of course, let's move on." },
    ]
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        reservations: [{
          text: "The pilot depends on artist participation that has not yet been established.",
          evidence_reference_ids: ["answer-1"],
        }],
      }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({ transcript, baseReport, facts })
    expect(report.detailed_opinion?.reservations).toEqual([])
    const writerInput = JSON.stringify(createMock.mock.calls[0]?.[0]?.messages)
    expect(writerInput).not.toContain("Can we move on?")
    expect(writerInput).not.toContain("Of course, let's move on.")

    createMock.mockReset()
    const invalidDraft = response({
      ...evaluation,
      reservations: [{ text: "Applicant changed topic twice.", evidence_reference_ids: ["process-turn"] }],
    })
    createMock.mockResolvedValueOnce(invalidDraft).mockResolvedValueOnce(invalidDraft)
    await expect(generateDetailedReviewerReport({ transcript, baseReport, facts }))
      .rejects.toThrow("invalid opinion")
    expect(createMock).toHaveBeenCalledTimes(2)
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
      advisory_evidence_reference_ids: ["curation-answer"],
      snapshot: {
        ...evaluation.snapshot,
        evidence_reference_ids: ["curation-answer"],
        tags: [{ value: "curatorial_sequencing", evidence_reference_ids: ["curation-answer"] }],
      },
      curatorial_approach: {
        present: true,
        summary: "Frames the programme through gradual emotional change.",
        evidence_reference_ids: ["curation-answer"],
        observed_dimensions: ["sequencing", "coherence", "audience_awareness"],
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
      facts: {
        version: 1,
        mediaChoice: {
          questionId: "programme-room",
          sourceMessageId: "curation-answer",
          mode: "remove",
          selectedOptionIds: ["performance-b"],
          retainedOptionIds: ["performance-a", "performance-c"],
          explicitOrderOptionIds: null,
          depthFollowupUsed: true,
          applicantClaims: [],
        },
        processFeedback: [{ kind: "requests_topic_change", sourceMessageId: "process-turn" }],
      },
    })

    expect(report.detailed_opinion?.curatorial_approach?.observed_dimensions)
      .toEqual(["coherence", "audience_awareness"])
    expect(report.detailed_opinion?.snapshot?.tags).toEqual([])
    expect(JSON.stringify(createMock.mock.calls[0]?.[0]?.messages)).toContain(
      "selected_options",
    )
    for (const call of createMock.mock.calls) {
      const prompt = JSON.stringify(call[0]?.messages)
      expect(prompt).toContain("explicitOrderOptionIds")
      expect(prompt).not.toContain("requests_topic_change")
    }
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
