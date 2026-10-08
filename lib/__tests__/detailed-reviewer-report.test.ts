import { beforeEach, describe, expect, it, vi } from "vitest"

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock }
  },
}))

import { generateDetailedReviewerReport } from "@/lib/detailed-reviewer-report"
import { COLORS_FORUM_MEMBERSHIP_RUBRIC, COLORS_FORUM_V1_RUBRIC } from "@/lib/application-signal-state"
import { COLORS_DETAILED_REPORT_VERSION, COLORS_FORUM_MEMBERSHIP_REPORT_VERSION } from "@/lib/reviewer-report"
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

  it.each([
    {
      answer: "I run a city music guide and publish weekly notes. I have a network of musicians and venues. Artists pay for most posts.",
      communityQuotes: ["publish weekly notes", "Artists pay for most posts"],
      expectedCoverage: "unverified",
    },
    {
      answer: "I publish a city guide and interview local musicians at shows.",
      communityQuotes: ["I publish a city guide and interview local musicians at shows"],
      expectedCoverage: "supported",
    },
    {
      answer: "I host a monthly listening table at our community centre.",
      communityQuotes: ["I host a monthly listening table"],
      expectedCoverage: "supported",
    },
  ])("grounds community participation in actual exchange: $expectedCoverage for $answer", async ({
    answer, communityQuotes, expectedCoverage,
  }) => {
    createMock
      .mockResolvedValueOnce(response({ signals: [
        { signal_key: "joining_motivation", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "colors_connection", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "music_relationship", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "community_participation", coverage: "supported", sources: communityQuotes.map((quote) => ({ source_message_id: "answer-1", quote })), material_gap: false, gap_reason: "" },
        { signal_key: "forum_participation", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "tones_connection", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      ] }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))
    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: answer }],
      baseReport,
      rubricVersion: COLORS_FORUM_MEMBERSHIP_RUBRIC,
      forumMembershipPilot: true,
    })
    expect(report.evidence_state?.find((entry) => entry.signal_key === "community_participation"))
      .toMatchObject({ coverage: expectedCoverage, material_gap: false })
    expect(report.evidence_references.filter((reference) => reference.signal_key === "community_participation"))
      .toHaveLength(expectedCoverage === "supported" ? 1 : 0)
  })

  it("uses the initial Forum's post-conversation lenses without making TONES a gap", async () => {
    const answer = "I make music with friends and reply in a producers' Discord."
    createMock
      .mockResolvedValueOnce(response({ signals: [
        { signal_key: "joining_motivation", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "colors_connection", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "music_relationship", coverage: "supported", sources: [{ source_message_id: "answer-1", quote: "I make music with friends" }], material_gap: false, gap_reason: "" },
        { signal_key: "community_participation", coverage: "supported", sources: [{ source_message_id: "answer-1", quote: "reply in a producers' Discord" }], material_gap: false, gap_reason: "" },
        { signal_key: "forum_participation", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "tones_connection", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      ] }))
      .mockResolvedValueOnce(response({
        ...evaluation,
        applicant_bio: "The applicant makes music with friends and replies in a producers' Discord.",
        advisory_reason: "They describe making music and taking part in a producers' Discord.",
        snapshot: {
          applicant_summary: "The applicant makes music with friends and replies in a producers' Discord.",
          evidence_reference_ids: ["answer-1"],
          tags: [{ value: "music_relationship", evidence_reference_ids: ["answer-1"] }],
        },
        claim_assessments: [{
          claim: "The applicant makes music with friends and replies in a producers' Discord.",
          evidence_reference_ids: ["answer-1"],
          interpretation: "A concrete music and community connection.",
          assessment: "strength",
        }],
        reviewer_questions: [],
      }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))
    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: answer }],
      baseReport,
      rubricVersion: COLORS_FORUM_MEMBERSHIP_RUBRIC,
      forumMembershipPilot: true,
    })
    expect(report.report_version).toBe(COLORS_FORUM_MEMBERSHIP_REPORT_VERSION)
    expect(report.evidence_state).toHaveLength(6)
    expect(report.evidence_state?.find((item) => item.signal_key === "tones_connection"))
      .toMatchObject({ coverage: "unverified", material_gap: false })
    expect(report.evidence_references).toContainEqual(expect.objectContaining({
      signal_key: "music_relationship", source_message_id: "answer-1",
    }))
    expect(String(createMock.mock.calls[1]?.[0]?.system)).toContain("TONES awareness or first-hand experience")
    expect(String(createMock.mock.calls[1]?.[0]?.system)).toContain("with no audio uploads")
    expect(String(createMock.mock.calls[0]?.[0]?.system)).toContain("Offline groups, events and scenes count as much as online discussion")
    expect(String(createMock.mock.calls[0]?.[0]?.system)).toContain("Its cited quote must itself state that intended Forum action")
    for (const call of createMock.mock.calls.slice(1)) {
      expect(String(call[0]?.messages?.[0]?.content)).not.toContain("preliminaryAdvisory")
      expect(String(call[0]?.system)).not.toContain("preliminary advisory")
    }
  })

  it("reconciles full V1 transcript evidence before writing and verifies the exact saved report", async () => {
    const v1Report: ReviewerReport = {
      ...baseReport,
      evidence_references: [{
        signal_key: "community_participation",
        signal_label: "Community participation",
        source_message_id: "answer-1",
        excerpt: "I host a listening table.",
      }, {
        signal_key: "forum_hopes",
        signal_label: "Forum hopes",
        source_message_id: "answer-2",
        excerpt: "Yseult's Corps",
      }],
      weak_or_missing_signals: [
        "Artist engagement: not explored in this conversation.",
        "Relationship to COLORS: not explored in this conversation.",
      ],
    }
    const state = { signals: [
      { signal_key: "forum_hopes", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      { signal_key: "community_participation", coverage: "supported", sources: [{ source_message_id: "answer-1", quote: "I host a listening table." }], material_gap: false, gap_reason: "" },
      { signal_key: "reciprocal_contribution", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      { signal_key: "artist_engagement", coverage: "supported", sources: [{ source_message_id: "answer-2", quote: "Yseult's Corps" }], material_gap: false, gap_reason: "" },
      { signal_key: "colors_relationship", coverage: "supported", sources: [{ source_message_id: "answer-2", quote: "Yseult's Corps on COLORS" }], material_gap: false, gap_reason: "" },
    ] }
    const draft = {
      ...evaluation,
      applicant_bio: "Hosts a listening table and follows Yseult's COLORS performance.",
      advisory_reason: "The applicant describes a listening table and specific engagement with a COLORS performance.",
      reviewer_questions: ["What is their favourite colour?"],
    }
    createMock
      .mockResolvedValueOnce(response(state))
      .mockResolvedValueOnce(response(draft))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [
        { id: "answer-1", role: "user", content: "I host a listening table." },
        { id: "answer-2", role: "user", content: "I keep returning to Yseult's Corps on COLORS." },
      ],
      baseReport: v1Report,
      rubricVersion: COLORS_FORUM_V1_RUBRIC,
      terminalStatus: "passed",
    })

    expect(report.report_version).toBe(COLORS_DETAILED_REPORT_VERSION)
    expect(report.weak_or_missing_signals).toEqual([])
    expect(report.evidence_state?.find((entry) => entry.signal_key === "artist_engagement"))
      .toMatchObject({ coverage: "supported", source_message_ids: ["answer-2"] })
    expect(report.evidence_references).toContainEqual(expect.objectContaining({
      signal_key: "colors_relationship",
      source_message_id: "answer-2",
    }))
    expect(report.evidence_references.some((reference) =>
      reference.signal_key === "forum_hopes" && reference.source_message_id === "answer-2",
    )).toBe(false)
    expect(report.detailed_opinion?.reviewer_questions).toEqual([])
    expect(report.reviewer_focus).toBe(draft.advisory_reason)
    expect(createMock).toHaveBeenCalledTimes(3)
    const writerInput = String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content)
    expect(writerInput).toContain("Yseult's Corps on COLORS")
    expect(writerInput).not.toContain("Artist engagement: not explored")
    const verifierInput = JSON.parse(String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content)
      .split("\n\nSource-linked integrity observations")[0])
    expect(verifierInput.assembledReport).toEqual(report)
  })

  it("repairs evidence-state citations that point to process feedback", async () => {
    const signals = [
      { signal_key: "forum_hopes", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      { signal_key: "community_participation", coverage: "supported", sources: [{ source_message_id: "answer-1", quote: "I host a listening table." }], material_gap: false, gap_reason: "" },
      { signal_key: "reciprocal_contribution", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      { signal_key: "artist_engagement", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      { signal_key: "colors_relationship", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
    ]
    createMock
      .mockResolvedValueOnce(response({ signals: [{
        ...signals[0],
        coverage: "supported",
        sources: [{ source_message_id: "process-turn", quote: "What did you mean?" }],
      }, ...signals.slice(1)] }))
      .mockResolvedValueOnce(response({ signals }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [
        { id: "answer-1", role: "user", content: "I host a listening table." },
        { id: "process-turn", role: "user", content: "What did you mean?" },
      ],
      baseReport,
      rubricVersion: COLORS_FORUM_V1_RUBRIC,
      facts: {
        version: 1,
        mediaChoice: null,
        processFeedback: [{ kind: "clarification_request", sourceMessageId: "process-turn" }],
      },
    })

    expect(report.evidence_state?.find((entry) => entry.signal_key === "forum_hopes")?.coverage)
      .toBe("unverified")
    expect(report.evidence_references.some((reference) => reference.source_message_id === "process-turn"))
      .toBe(false)
    expect(String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content))
      .toContain("lacks an exact applicant quote")
  })

  it("accepts typographic punctuation differences while storing the source's exact wording", async () => {
    const source = "I host a listening table. I’d like a Forum where listeners compare what they hear."
    createMock
      .mockResolvedValueOnce(response({ signals: [
        { signal_key: "forum_hopes", coverage: "supported", sources: [{ source_message_id: "answer-1", quote: "I'd like a Forum where listeners compare what they hear." }], material_gap: false, gap_reason: "" },
        { signal_key: "community_participation", coverage: "supported", sources: [{ source_message_id: "answer-1", quote: "I host a listening table." }], material_gap: false, gap_reason: "" },
        { signal_key: "reciprocal_contribution", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "artist_engagement", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
        { signal_key: "colors_relationship", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      ] }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: source }],
      baseReport,
      rubricVersion: COLORS_FORUM_V1_RUBRIC,
    })
    expect(report.evidence_references).toContainEqual(expect.objectContaining({
      signal_key: "forum_hopes",
      excerpt: "I’d like a Forum where listeners compare what they hear.",
    }))
    expect(createMock).toHaveBeenCalledTimes(3)
  })

  it("reconciles the evidence state again when the final verifier rejects an invented gap", async () => {
    const source = "I host a listening table and keep returning to Yseult's Corps."
    const signals = [
      { signal_key: "forum_hopes", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      { signal_key: "community_participation", coverage: "supported", sources: [{ source_message_id: "answer-1", quote: "I host a listening table" }], material_gap: false, gap_reason: "" },
      { signal_key: "reciprocal_contribution", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
      { signal_key: "artist_engagement", coverage: "partial", sources: [{ source_message_id: "answer-1", quote: "Yseult's Corps" }], material_gap: true, gap_reason: "Artist exchange has not been tested at Forum scale." },
      { signal_key: "colors_relationship", coverage: "unverified", sources: [], material_gap: false, gap_reason: "" },
    ]
    createMock
      .mockResolvedValueOnce(response({ signals }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: false, issues: [
        "evidence_state invents a Forum-scale material gap from an artist interest already shown.",
      ], repair_target: "evidence_state" }))
      .mockResolvedValueOnce(response({ signals: signals.map((signal) =>
        signal.signal_key === "artist_engagement"
          ? { ...signal, coverage: "supported", material_gap: false, gap_reason: "" }
          : signal,
      ) }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: source }],
      baseReport,
      rubricVersion: COLORS_FORUM_V1_RUBRIC,
    })

    expect(report.weak_or_missing_signals).toEqual([])
    expect(report.evidence_state?.find((signal) => signal.signal_key === "artist_engagement")?.coverage)
      .toBe("supported")
    expect(String(createMock.mock.calls[3]?.[0]?.messages?.[0]?.content))
      .toContain("evidence_state invents a Forum-scale material gap")
    expect(createMock).toHaveBeenCalledTimes(6)
  })

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
      expect(instructions).toContain("mandatory question checklist")
      expect(instructions).toContain("does not establish an order")
      expect(instructions).toContain("not the same as asking permission")
      expect(instructions).toContain("does not prove the applicant would knowingly post after an explicit refusal")
      expect(instructions).toContain("requests for Groucho to clarify")
      expect(instructions).toContain("One hosted night and one song shared with a friend")
      expect(instructions).toContain("Do not call isolated examples a consistent practice")
    }
  })

  it("retries when isolated examples are described as a sustained practice", async () => {
    const isolatedReport: ReviewerReport = {
      ...baseReport,
      evidence_references: [{
        ...baseReport.evidence_references[0],
        excerpt: "I hosted one listening night and sent a song to a friend.",
      }],
    }
    const corrected = {
      ...evaluation,
      advisory_reason: "The applicant describes one hosted night and one song shared with a friend.",
      overall_assessment: "Two concrete examples support the applicant's proposed contribution, without establishing a recurring practice.",
      decisive_reasons: ["The applicant describes one hosted night and one shared song."],
      likely_contribution: "They propose to convene a listening circle.",
    }
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        advisory_reason: "The applicant has a sustained listening practice.",
      }))
      .mockResolvedValueOnce(response({
        supported: false,
        issues: ["One night and one song do not establish a sustained practice."],
      }))
      .mockResolvedValueOnce(response(corrected))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{
        id: "answer-1",
        role: "user",
        content: "I hosted one listening night and sent a song to a friend.",
      }],
      baseReport: isolatedReport,
      terminalStatus: "passed",
    })

    expect(createMock).toHaveBeenCalledTimes(4)
    expect(report.detailed_opinion?.advisory_reason).toBe(corrected.advisory_reason)
    const retryInput = String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content)
    expect(retryInput).toContain("One night and one song do not establish a sustained practice.")
    expect(retryInput).toContain('"advisory_reason":"The applicant has a sustained listening practice."')
  })

  it("accepts a reason above the editorial target when it fits the report field", async () => {
    const longerReason = `${evaluation.advisory_reason} ${"A".repeat(200)}`
    createMock
      .mockResolvedValueOnce(response({ ...evaluation, advisory_reason: longerReason }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport,
    })

    expect(report.detailed_opinion?.advisory_reason).toBe(longerReason)
    expect(createMock).toHaveBeenCalledTimes(2)
    expect(String((createMock.mock.calls[1]?.[0] as { system?: unknown })?.system))
      .toContain("length alone does not invalidate a source-supported report")
  })

  it("repairs a reason longer than the report field without starting a blank report", async () => {
    createMock
      .mockResolvedValueOnce(response({ ...evaluation, advisory_reason: "A".repeat(801) }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport,
    })

    expect(report.detailed_opinion?.advisory_reason).toBe(evaluation.advisory_reason)
    expect(createMock).toHaveBeenCalledTimes(3)
    const repairInput = String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content)
    expect(repairInput).toContain("at most 800 characters")
    expect(repairInput).toContain('"applicant_bio":"Hosts a listening table."')
  })

  it("retries malformed model JSON with a specific validation issue", async () => {
    createMock
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "not json" }],
        stop_reason: "end_turn",
        usage: {},
      })
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport,
    })

    expect(report.detailed_opinion?.overall_assessment).toBe(evaluation.overall_assessment)
    expect(String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content))
      .toContain("invalid draft not object field")
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
      .mockResolvedValueOnce(response({
        decisions: [{ index: 0, supported: true, reason: "" }],
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
    const verifierInput = String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content)
    expect(verifierInput).toContain('"advisory_recommendation":"recommend"')
    expect(verifierInput).toContain('"reviewer_questions":["How does the listening table operate?"]')
    expect(verifierInput).toContain('"reviewer_focus":"How does the listening table operate?"')
  })

  it("omits an unsupported reviewer question without failing the core report", async () => {
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        reviewer_questions: [
          "Does your shift work prevent weekly synchronous Forum attendance?",
          "What would you hope to discuss with other listeners?",
        ],
      }))
      .mockResolvedValueOnce(response({ decisions: [
        { index: 0, supported: false, reason: "No synchronous attendance requirement was supplied." },
        { index: 1, supported: true, reason: "" },
      ] }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I work shifts and host a listening table." }],
      baseReport,
      terminalStatus: "passed",
    })

    expect(report.detailed_opinion?.reviewer_questions).toEqual([
      "What would you hope to discuss with other listeners?",
    ])
    expect(report.reviewer_focus).toBe("What would you hope to discuss with other listeners?")
    expect(createMock).toHaveBeenCalledTimes(3)
    const verifierInput = String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content)
    expect(verifierInput).toContain('"reviewer_focus":"What would you hope to discuss with other listeners?"')
    expect(verifierInput).not.toContain("Does your shift work prevent weekly synchronous Forum attendance?")
  })

  it("omits optional questions when their verifier is unavailable", async () => {
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        reviewer_questions: ["What would you hope to discuss with other listeners?"],
      }))
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport: {
        ...baseReport,
        reviewer_focus: "Can they attend a synchronous Forum every week?",
      },
    })

    expect(report.detailed_opinion?.reviewer_questions).toEqual([])
    expect(report.reviewer_focus).toBe(
      "Review the applicant's source-linked evidence and proposed contribution.",
    )
    expect(report.detailed_opinion?.overall_assessment).toBe(evaluation.overall_assessment)
    expect(String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content))
      .toContain('"reviewer_questions":[]')
  })

  it("checks the assembled headline and weak signals against the claims before returning", async () => {
    const weakReport = {
      ...baseReport,
      weak_or_missing_signals: ["Community participation: insufficient evidence in this conversation."],
    }
    const overstated = {
      ...evaluation,
      advisory_reason: "The applicant has an established online community practice.",
      claim_assessments: [{
        ...evaluation.claim_assessments[0],
        claim: "Runs a sustained online listening community.",
      }],
    }
    const corrected = {
      ...evaluation,
      advisory_recommendation: "human_review",
      advisory_reason: "One hosted listening table is concrete, while broader community participation remains untested.",
      claim_assessments: [{
        ...evaluation.claim_assessments[0],
        claim: "Describes hosting one listening table.",
        interpretation: "This is one concrete example, not an established online-community practice.",
      }],
      suggested_human_action: "discuss",
    }
    createMock
      .mockResolvedValueOnce(response(overstated))
      .mockResolvedValueOnce(response({
        supported: false,
        issues: ["claim_assessments and advisory_reason describe established participation while weak_or_missing_signals says it remains insufficient."],
      }))
      .mockResolvedValueOnce(response(corrected))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I hosted one listening table." }],
      baseReport: weakReport,
    })

    expect(report.detailed_opinion?.advisory_reason).toBe(corrected.advisory_reason)
    expect(createMock).toHaveBeenCalledTimes(4)
    const verifierInput = String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content)
    expect(verifierInput).toContain('"weak_or_missing_signals":["Community participation: insufficient evidence in this conversation."]')
    expect(verifierInput).toContain('"claim":"Runs a sustained online listening community."')
    expect(verifierInput).toContain('"reviewer_focus":"Review the applicant\'s source-linked evidence and proposed contribution."')
    expect(String(createMock.mock.calls[1]?.[0]?.system)).toContain("Finally check the assembled report")
    expect(String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content))
      .toContain("claim_assessments and advisory_reason describe established participation")
  })

  it("retries a stale weak signal rather than changing the report after verification", async () => {
    const weakReport = {
      ...baseReport,
      weak_or_missing_signals: [
        "Community participation: not explored in this conversation.",
        "Artist engagement: not explored in this conversation.",
      ],
    }
    createMock
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({
        supported: false,
        issues: ["Community participation is directly cited but marked not explored."],
      }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({
        supported: false,
        issues: ["Community participation is directly cited but marked not explored."],
      }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({
        supported: false,
        issues: ["Community participation is directly cited but marked not explored."],
      }))

    await expect(generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport: weakReport,
    })).rejects.toThrow("Community participation is directly cited but marked not explored")

    expect(weakReport.weak_or_missing_signals).toHaveLength(2)
    const verifierInput = String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content)
    expect(verifierInput).toContain("Community participation: not explored in this conversation.")
    expect(verifierInput).toContain("Artist engagement: not explored in this conversation.")
    expect(String(createMock.mock.calls[1]?.[0]?.system))
      .toContain("Verify the exact assembled object")
  })

  it("keeps a material reservation ahead of a routine question in the headline focus", async () => {
    createMock
      .mockResolvedValueOnce(response({
        ...evaluation,
        advisory_recommendation: "human_review",
        claim_assessments: [{
          claim: "Dismisses listeners who disagree.",
          evidence_reference_ids: ["answer-1"],
          interpretation: "This raises a concern about reciprocal discussion.",
          assessment: "concern",
        }],
        reservations: [{
          text: "The stated approach to disagreement needs review.",
          evidence_reference_ids: ["answer-1"],
        }],
        reviewer_questions: ["What else would the applicant hope to discuss?"],
        suggested_human_action: "discuss",
      }))
      .mockResolvedValueOnce(response({
        decisions: [{ index: 0, supported: true, reason: "" }],
      }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I dismiss listeners who disagree." }],
      baseReport,
    })

    expect(report.reviewer_focus).toBe("The stated approach to disagreement needs review.")
    expect(String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content))
      .toContain('"reviewer_focus":"The stated approach to disagreement needs review."')
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

  it("repairs a rejected draft and still fails after the bounded retries", async () => {
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
      .mockResolvedValueOnce(response(unsupported))
      .mockResolvedValueOnce(response(rejected))

    await expect(generateDetailedReviewerReport(input)).rejects.toThrow("professional title")
    expect(createMock).toHaveBeenCalledTimes(6)
  })

  it("repairs a pre-consent concern without inventing defiance of an explicit refusal", async () => {
    const concernBase: ReviewerReport = {
      ...baseReport,
      advisory_recommendation: "decline",
      safety_or_integrity_flags: ["Applicant described posting private clips without prior permission."],
      evidence_references: [{
        ...baseReport.evidence_references[0],
        excerpt: "I post private artist clips before asking and remove them if the artist objects.",
      }],
    }
    const unsupported = {
      ...evaluation,
      advisory_recommendation: "decline",
      advisory_reason: "The applicant would post even after an artist explicitly refused.",
      claim_assessments: [{
        claim: "The applicant posts despite explicit refusal.",
        evidence_reference_ids: ["answer-1"],
        interpretation: "This shows defiance of a known refusal.",
        assessment: "concern",
      }],
      suggested_human_action: "decline",
    }
    const corrected = {
      ...unsupported,
      advisory_reason: "The applicant reports posting private artist clips before asking, then removing them if an artist objects.",
      claim_assessments: [{
        claim: "The applicant posts private artist clips before asking permission.",
        evidence_reference_ids: ["answer-1"],
        interpretation: "Removal after objection does not erase the prior-permission concern.",
        assessment: "concern",
      }],
    }
    createMock
      .mockResolvedValueOnce(response(unsupported))
      .mockResolvedValueOnce(response({
        supported: false,
        issues: ["The source describes posting before asking, not posting after a known refusal."],
      }))
      .mockResolvedValueOnce(response(corrected))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{
        id: "answer-1",
        role: "user",
        content: "I post private artist clips before asking and remove them if the artist objects.",
      }],
      baseReport: concernBase,
      terminalStatus: "rejected",
    })

    expect(report.advisory_recommendation).toBe("decline")
    expect(report.detailed_opinion?.advisory_reason).toBe(corrected.advisory_reason)
    const repairInput = String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content)
    expect(repairInput).toContain("not posting after a known refusal")
    expect(repairInput).toContain('"claim":"The applicant posts despite explicit refusal."')
  })

  it("retries a verifier rejection even when the verifier supplies no issues", async () => {
    createMock
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: false, issues: [] }))
      .mockResolvedValueOnce(response(evaluation))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))

    const report = await generateDetailedReviewerReport({
      transcript: [{ id: "answer-1", role: "user", content: "I host a listening table." }],
      baseReport,
    })

    expect(report.detailed_opinion?.overall_assessment).toBe(evaluation.overall_assessment)
    expect(String(createMock.mock.calls[2]?.[0]?.messages?.[0]?.content))
      .toContain("rejected the report without a specific issue")
  })

  it("rejects a consent concern attached to an artist named only later", async () => {
    const concernBase = {
      ...baseReport,
      safety_or_integrity_flags: ["Applicant described sharing artist work without permission."],
      evidence_references: [
        { ...baseReport.evidence_references[0], source_message_id: "consent-1", excerpt: "I post private demos without asking." },
        { ...baseReport.evidence_references[0], source_message_id: "artist-2", excerpt: "Nia Vale's unfinished recordings feel direct." },
      ],
    }
    const unsupported = {
      ...evaluation,
      advisory_evidence_reference_ids: ["consent-1"],
      snapshot: { ...evaluation.snapshot, evidence_reference_ids: ["consent-1"], tags: [] },
      claim_assessments: [{
        claim: "The applicant posted Nia Vale's private recordings.",
        evidence_reference_ids: ["consent-1", "artist-2"],
        interpretation: "They posted Nia's work without consent.",
        assessment: "concern",
      }],
      reviewer_questions: ["Did Nia Vale give permission for the clips?"],
    }
    const corrected = {
      ...evaluation,
      advisory_evidence_reference_ids: ["consent-1"],
      snapshot: { ...evaluation.snapshot, evidence_reference_ids: ["consent-1"], tags: [] },
      claim_assessments: [{
        claim: "The applicant says they post private demos without asking.",
        evidence_reference_ids: ["consent-1"],
        interpretation: "This reported practice needs human review.",
        assessment: "concern",
      }],
      reviewer_questions: ["How does the applicant seek permission before sharing private work?"],
    }
    createMock
      .mockResolvedValueOnce(response(unsupported))
      .mockResolvedValueOnce(response(corrected))
      .mockResolvedValueOnce(response({
        decisions: [{ index: 0, supported: true, reason: "" }],
      }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))
    const report = await generateDetailedReviewerReport({
      transcript: [
        { id: "consent-1", role: "user", content: "I post private demos without asking." },
        { id: "artist-2", role: "user", content: "Nia Vale's unfinished recordings feel direct." },
      ],
      baseReport: concernBase,
      integrityObservations: [{ kind: "artist_consent_violation", sourceMessageId: "consent-1", quote: "I post private demos without asking." }],
    })
    expect(createMock).toHaveBeenCalledTimes(4)
    expect(String(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content)).toContain("did not name that artist")
    expect(report.detailed_opinion?.reviewer_questions[0]).not.toContain("Nia")

    createMock.mockReset()
    createMock
      .mockResolvedValueOnce(response({
        ...unsupported,
        claim_assessments: [{
          claim: "The applicant says they would post Nia Vale's recordings without permission.",
          evidence_reference_ids: ["artist-2", "consent-1"],
          interpretation: "This is a stated intention, not a verified completed action.",
          assessment: "concern",
        }],
      }))
      .mockResolvedValueOnce(response({
        decisions: [{ index: 0, supported: false, reason: "The question assumes permission was sought." }],
      }))
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))
    await expect(generateDetailedReviewerReport({
      transcript: [
        { id: "artist-2", role: "user", content: "Nia Vale's unfinished recordings feel direct." },
        { id: "question", role: "assistant", content: "What would you do with Nia Vale's recordings?" },
        { id: "consent-1", role: "user", content: "I would post it without permission." },
      ],
      baseReport: concernBase,
      integrityObservations: [{ kind: "artist_consent_violation", sourceMessageId: "consent-1", quote: "I would post it without permission." }],
    })).resolves.toHaveProperty("detailed_opinion")
    expect(createMock).toHaveBeenCalledTimes(3)
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
    createMock
      .mockResolvedValueOnce(invalidDraft)
      .mockResolvedValueOnce(response({ supported: true, issues: [] }))
    const reportWithInvalidReservation = await generateDetailedReviewerReport({ transcript, baseReport, facts })
    expect(reportWithInvalidReservation.detailed_opinion?.reservations).toEqual([])
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
