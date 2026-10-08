import { describe, expect, it } from "vitest"
import {
  ensureEvidenceBackedReviewerReport,
  fallbackReviewerReport,
  normaliseReviewerReport,
  normaliseDetailedReviewerOpinion,
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

  it("retains the reconciled report version and source-linked coverage after loading", () => {
    const report = normaliseReviewerReport({
      report_version: "colors_forum_report_v2",
      evidence_state: [{
        signal_key: "artist_engagement",
        coverage: "supported",
        source_message_ids: ["answer-2"],
        material_gap: false,
        gap_reason: "",
      }],
      applicant_bio: "Discusses an artist's performance.",
      advisory_recommendation: "recommend",
      confidence_score: 0.8,
      evidence_references: [{
        signal_key: "artist_engagement",
        signal_label: "Artist engagement",
        source_message_id: "answer-2",
        excerpt: "I keep returning to this performance.",
      }],
      evidence_summary: [],
      weak_or_missing_signals: [],
      safety_or_integrity_flags: [],
      reviewer_focus: "Review the artist engagement evidence.",
    })
    expect(report?.report_version).toBe("colors_forum_report_v2")
    expect(report?.evidence_state).toEqual([expect.objectContaining({
      signal_key: "artist_engagement",
      source_message_ids: ["answer-2"],
    })])
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

  it("keeps only source-linked claims in a detailed opinion", () => {
    const opinion = normaliseDetailedReviewerOpinion(
      {
        advisory_reason: "The applicant describes a recurring listening practice.",
        advisory_evidence_reference_ids: ["message-1", "invented-source"],
        overall_assessment: "A credible community participant with one open question.",
        decisive_reasons: ["Shows recurring participation."],
        claim_assessments: [
          {
            claim: "Hosts a recurring listening night.",
            evidence_reference_ids: ["message-1"],
            interpretation: "This is demonstrated participation, not only intent.",
            assessment: "strength",
          },
          {
            claim: "Has a large professional network.",
            evidence_reference_ids: ["invented-source"],
            interpretation: "Unsupported.",
            assessment: "strength",
          },
        ],
        likely_contribution: "Could convene focused listening discussions.",
        reservations: [],
        reviewer_questions: ["How often could they participate?"],
        suggested_human_action: "discuss",
      },
      new Set(["message-1"]),
    )

    expect(opinion?.claim_assessments).toHaveLength(1)
    expect(opinion?.claim_assessments[0]?.evidence_reference_ids).toEqual([
      "message-1",
    ])
    expect(opinion?.advisory_evidence_reference_ids).toEqual(["message-1"])
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
        kind: "custom" as const,
        label: "How do you participate?",
        evidenceLabel: "Participation",
        goal: "Understand participation.",
        promptRoutes: [],
        priority: "core" as const,
        cluster: "participation",
        audiences: ["shared" as const],
      },
      {
        key: "contribution",
        kind: "custom" as const,
        label: "What would you contribute?",
        evidenceLabel: "Contribution",
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
    })

    expect(report.advisory_recommendation).toBe("human_review")
    expect(report.applicant_bio).not.toContain("curator")
    expect(report.applicant_bio).toContain("1 established evidence area")
    expect(report.evidence_summary).toEqual([
      "Participation: I host a monthly listening night.",
    ])
    expect(report.evidence_references).toEqual([
      {
        signal_key: "participation",
        signal_label: "Participation",
        source_message_id: "message-participation",
        excerpt: "I host a monthly listening night.",
      },
    ])
    expect(report.weak_or_missing_signals[0]).toContain("insufficient evidence")
  })

  it("keeps distinct exact quotes for several lenses in one applicant message", () => {
    const definitions = [
      { key: "forum_hopes", kind: "motivation" as const, label: "Forum hopes", evidenceLabel: "Forum hopes", goal: "Hope", promptRoutes: [], priority: "core" as const, cluster: "orientation", audiences: ["shared" as const] },
      { key: "community_participation", kind: "participation" as const, label: "Community participation", evidenceLabel: "Community participation", goal: "Participation", promptRoutes: [], priority: "core" as const, cluster: "community", audiences: ["shared" as const] },
    ]
    const first = "I host a small listening circle and hope the Forum lets more people listen together."
    const later = "The circle meets monthly and each person brings a moment worth revisiting."
    const report = ensureEvidenceBackedReviewerReport({
      report: null,
      terminalStatus: "passed",
      scores: { overall: 0.8 },
      definitions,
      answers: definitions.map((signal) => ({
        ...signal,
        answer: first,
        covered: true,
        sources: [{ messageId: "m1", excerpt: first }],
      })),
      messages: [
        { id: "m1", role: "user", content: first, metadata: { application_evidence_quotes: [
          { key: "forum_hopes", quote: "hope the Forum lets more people listen together" },
          { key: "community_participation", quote: "I host a small listening circle" },
        ] } },
        { id: "m2", role: "user", content: later, metadata: { application_evidence_quotes: [
          { key: "community_participation", quote: "The circle meets monthly" },
        ] } },
      ],
    })
    expect(report.evidence_references).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal_key: "forum_hopes", source_message_id: "m1", excerpt: "hope the Forum lets more people listen together" }),
      expect.objectContaining({ signal_key: "community_participation", source_message_id: "m1", excerpt: "I host a small listening circle" }),
      expect.objectContaining({ signal_key: "community_participation", source_message_id: "m2", excerpt: "The circle meets monthly" }),
    ]))
    expect(report.evidence_summary).toContain("Community participation: The circle meets monthly")
  })

  it("does not promote an attempted but unverified Forum answer into lens evidence", () => {
    const signal = {
      key: "artist_engagement", kind: "artist_reference" as const,
      label: "Artist engagement", evidenceLabel: "Artist engagement", goal: "Artist interest",
      promptRoutes: [], priority: "supporting" as const,
      cluster: "cultural_point_of_view", audiences: ["shared" as const],
    }
    const report = ensureEvidenceBackedReviewerReport({
      report: null, terminalStatus: "passed", scores: { overall: 0.8 },
      definitions: [signal],
      answers: [{ ...signal, covered: true, answer: "An unnamed track.\nFollow-up: I keep returning to Ojerime.", sources: [
        { messageId: "unnamed", excerpt: "An unnamed track." },
        { messageId: "named", excerpt: "I keep returning to Ojerime." },
      ] }],
      messages: [
        { id: "opening", role: "assistant", content: "Why join?", metadata: { application_rubric_version: "colors_forum_v1" } },
        { id: "unnamed", role: "user", content: "An unnamed track changed on a second listen.", metadata: { application_signal: { key: "artist_engagement", label: "Artist engagement" } } },
        { id: "named", role: "user", content: "I keep returning to Ojerime.", metadata: { application_evidence_quotes: [{ key: "artist_engagement", quote: "I keep returning to Ojerime" }] } },
      ],
    })
    expect(report.evidence_references.filter((reference) => reference.signal_key === "artist_engagement"))
      .toEqual([])
    expect(report.evidence_references.find((reference) => reference.source_message_id === "named"))
      .toEqual(expect.objectContaining({
        signal_key: "conversation_context",
        excerpt: "I keep returning to Ojerime.",
      }))
    expect(report.evidence_references.find((reference) => reference.source_message_id === "unnamed")?.signal_key).toBe("conversation_context")
    expect(report.evidence_summary).toEqual([
      "Transcript excerpt: An unnamed track changed on a second listen.",
      "Transcript excerpt: I keep returning to Ojerime.",
    ])
    expect(report.weak_or_missing_signals).toEqual([])
    expect(report.advisory_recommendation).toBe("human_review")
    expect(report.reviewer_focus).toContain("full-transcript evidence review")
  })

  it("does not treat an applicant request for a media source as extra fit evidence", () => {
    const report = ensureEvidenceBackedReviewerReport({
      report: null, terminalStatus: "redirected", scores: { overall: 0.55 },
      definitions: [], answers: [],
      messages: [
        { id: "media-request", role: "user", content: "Could you show me a performance so I can respond to something real?", metadata: { application_media_request: { format: "link" } } },
        { id: "substantive", role: "user", content: "I welcome newcomers in my design group.", metadata: {} },
      ],
    })
    expect(report.evidence_references.map((reference) => reference.source_message_id)).toEqual(["substantive"])
    expect(report.evidence_summary.join(" ")).not.toContain("Could you show me")
  })

  it("retains contextual transcript evidence that did not map to a signal", () => {
    const report = ensureEvidenceBackedReviewerReport({
      report: null,
      terminalStatus: "redirected",
      scores: { overall: 0.6 },
      definitions: [],
      answers: [],
      messages: [
        {
          id: "maker-context",
          role: "user",
          content: "I make cinematic soundtracks.",
          metadata: {
            answer_assessment: { quality: "usable" },
          },
        },
        {
          id: "cultural-context",
          role: "user",
          content: "Lucki's songwriting feels almost poetic.",
          metadata: {
            answer_assessment: { quality: "thin" },
          },
        },
        {
          id: "clarification-request",
          role: "user",
          content: "That sounds like two questions. What do you want to know?",
          metadata: {
            application_answer_relation: { kind: "clarification_request" },
          },
        },
        {
          id: "process-correction",
          role: "user",
          content: "I did not give those works an order. Can we move on?",
          metadata: {
            application_process_feedback: { kind: "corrects_assistant_assumption" },
          },
        },
      ],
    })

    expect(report.evidence_summary).toContain(
      "Additional transcript evidence: I make cinematic soundtracks.",
    )
    expect(report.evidence_summary).toContain(
      "Context needing follow-up: Lucki's songwriting feels almost poetic.",
    )
    expect(report.evidence_references).toContainEqual({
      signal_key: "conversation_context",
      signal_label: "Conversation context",
      source_message_id: "maker-context",
      excerpt: "I make cinematic soundtracks.",
    })
    expect(report.evidence_references.some(
      (reference) => reference.source_message_id === "clarification-request",
    )).toBe(false)
    expect(report.evidence_references.some(
      (reference) => reference.source_message_id === "process-correction",
    )).toBe(false)
  })

  it.each([
    {
      mode: "rank" as const,
      optionIds: ["performance-c", "performance-a"],
      expectedOptions: [
        { id: "performance-c", label: "Performance C", position: 1 },
        { id: "performance-a", label: "Performance A", position: 2 },
      ],
      content: "Ranked: 1. Performance C; 2. Performance A\nReason: The contrast creates a clear emotional arc.",
    },
    {
      mode: "remove" as const,
      optionIds: ["performance-b"],
      expectedOptions: [
        { id: "performance-b", label: "Performance B" },
      ],
      content: "Removed: Performance B\nReason: The remaining performances leave more space for a gradual change in energy.",
    },
  ])("preserves typed $mode media-choice evidence for the reviewer", ({
    mode,
    optionIds,
    expectedOptions,
    content,
  }) => {
    const mediaChoice = {
      id: "programme-room",
      options: ["a", "b", "c"].map((suffix) => ({
        id: `performance-${suffix}`,
        label: `Performance ${suffix.toUpperCase()}`,
        media: {
          type: "video",
          provider: "youtube",
          videoId: `${suffix}bcdef12345`,
          title: `Performance ${suffix.toUpperCase()}`,
          alt: `Artist ${suffix.toUpperCase()} performing`,
        },
      })),
      selection: {
        mode,
        minSelections: mode === "rank" ? 2 : 1,
        maxSelections: mode === "rank" ? 2 : 1,
      },
      rationale: {
        required: true,
        prompt: "Explain the programme decision.",
        maxLength: 500,
      },
    }
    const rationale = content.split("Reason: ")[1]
    const report = ensureEvidenceBackedReviewerReport({
      report: null,
      terminalStatus: "redirected",
      scores: { overall: 0.6 },
      definitions: [],
      answers: [],
      messages: [
        {
          id: "curation-question",
          role: "assistant",
          content: "Make a programme decision and explain it.",
          metadata: { ui: { inputType: "mediaChoice", mediaChoice } },
        },
        {
          id: "curation-answer",
          role: "user",
          content,
          metadata: {
            interaction_answer: {
              type: "mediaChoice",
              questionId: "programme-room",
              mode,
              optionIds,
              rationale,
            },
          },
        },
      ],
    })

    expect(report.evidence_references).toContainEqual({
      signal_key: "conversation_context",
      signal_label: "Conversation context",
      source_message_id: "curation-answer",
      excerpt: content,
      preceding_question: "Make a programme decision and explain it.",
      interaction: {
        type: "mediaChoice",
        question_id: "programme-room",
        mode,
        selected_options: expectedOptions,
        rationale,
      },
    })
  })

  it("links an open answer to the approved image or link it was shown with", () => {
    const cards = [{
      id: "yt_abc123xyz01",
      kind: "image",
      title: "Artist One - Song",
      url: "https://www.youtube.com/watch?v=abc123xyz01",
      imageUrl: "https://i.ytimg.com/vi/abc123xyz01/hqdefault.jpg",
      alt: "Artist One official COLORS performance thumbnail",
    }]
    const report = ensureEvidenceBackedReviewerReport({
      report: null,
      terminalStatus: "redirected",
      scores: { overall: 0.6 },
      definitions: [],
      answers: [],
      messages: [
        { id: "reference-question", role: "assistant", content: "What discussion would this start?", metadata: { ui: { inputType: "text", referenceCards: cards } } },
        { id: "reference-answer", role: "user", content: "I would ask what the singer leaves unresolved." },
      ],
    })
    expect(report.evidence_references).toContainEqual(expect.objectContaining({
      source_message_id: "reference-answer",
      preceding_question: "What discussion would this start?",
      interaction: { type: "references", cards },
    }))
  })

  it("normalises source-linked curatorial synthesis and structured evidence", () => {
    const report = normaliseReviewerReport({
      applicant_bio: "Applicant completed a programming exercise.",
      advisory_recommendation: "human_review",
      confidence_score: 0.65,
      evidence_summary: [],
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
      weak_or_missing_signals: [],
      safety_or_integrity_flags: [],
      reviewer_focus: "Review the rationale.",
      detailed_opinion: {
        snapshot: {
          applicant_summary: "Offers a hypothetical programming rationale centred on a gradual emotional arc.",
          evidence_reference_ids: ["curation-answer", "invented-source"],
          tags: [
            {
              value: "curatorial_sequencing",
              evidence_reference_ids: ["curation-answer"],
            },
            {
              value: "audience_awareness",
              evidence_reference_ids: ["invented-source"],
            },
            {
              value: "unsupported_tag",
              evidence_reference_ids: ["curation-answer"],
            },
          ],
        },
        overall_assessment: "The rationale shows one hypothetical programming approach.",
        decisive_reasons: [],
        claim_assessments: [{
          claim: "The applicant considered the programme arc.",
          evidence_reference_ids: ["curation-answer"],
          interpretation: "The reasoning concerns coherence, not artist preference.",
          assessment: "context",
        }],
        likely_contribution: "Could contribute considered programming discussion.",
        reservations: [],
        reviewer_questions: [],
        curatorial_approach: {
          present: true,
          summary: "Frames the programme through gradual emotional change.",
          evidence_reference_ids: ["curation-answer", "invented-source"],
          observed_dimensions: ["coherence", "audience_awareness", "invalid"],
        },
        suggested_human_action: "discuss",
      },
    })

    expect(report?.evidence_references[0]?.interaction).toMatchObject({
      mode: "remove",
      rationale: "The remaining set creates a gradual arc.",
    })
    expect(report?.detailed_opinion?.curatorial_approach).toEqual({
      present: true,
      summary: "Frames the programme through gradual emotional change.",
      evidence_reference_ids: ["curation-answer"],
      observed_dimensions: ["coherence", "audience_awareness"],
    })
    expect(report?.detailed_opinion?.snapshot).toEqual({
      applicant_summary: "Offers a hypothetical programming rationale centred on a gradual emotional arc.",
      evidence_reference_ids: ["curation-answer"],
      tags: [{
        value: "curatorial_sequencing",
        evidence_reference_ids: ["curation-answer"],
      }],
    })
  })

  it("replaces untraceable model evidence with persisted application evidence", () => {
    const definition = {
      key: "participation",
      kind: "custom" as const,
      label: "Participation",
      evidenceLabel: "Participation",
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

  it("uses only provenance-verified integrity flags for the COLORS report", () => {
    const report = ensureEvidenceBackedReviewerReport({
      report: normaliseReviewerReport({
        applicant_bio: "Listener who hosts an opt-in table.",
        advisory_recommendation: "human_review",
        confidence_score: 0.6,
        evidence_summary: [],
        weak_or_missing_signals: [],
        safety_or_integrity_flags: ["Applicant shared unreleased work without permission."],
        reviewer_focus: "Review the alleged consent concern.",
      }),
      terminalStatus: "passed",
      scores: { overall: 0.8 },
      definitions: [],
      answers: [],
      integrityFlags: ["Verified concern from persisted application state."],
      serverControlledFieldsOnly: true,
    })

    expect(report.safety_or_integrity_flags).toEqual([
      "Verified concern from persisted application state.",
    ])
    expect(report.applicant_bio).toContain("0 established evidence areas")
    expect(report.applicant_bio).not.toContain("opt-in table")
    expect(report.reviewer_focus).not.toBe("Review the alleged consent concern.")
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

  it("keeps each signal link when one full applicant answer supports multiple signals", () => {
    const definitions = ["participation", "contribution", "unasked"].map((key) => ({
      key,
      kind: "custom" as const,
      label: key,
      evidenceLabel: key,
      goal: key,
      promptRoutes: [],
      priority: "core" as const,
      cluster: key,
      audiences: ["shared" as const],
    }))
    const fullAnswer = "I host a listening circle every month. We send artists notes only when they ask for them, and I would bring that practice to the Forum."
    const report = ensureEvidenceBackedReviewerReport({
      report: null,
      terminalStatus: "redirected",
      scores: { overall: 0.6 },
      definitions,
      answers: definitions.slice(0, 2).map((definition) => ({
        ...definition,
        answer: fullAnswer,
        covered: true,
        sources: [{ messageId: "answer-1", excerpt: fullAnswer.slice(0, 25) }],
      })),
      messages: [
        { id: "question-1", role: "assistant", content: "How have you participated with other listeners or artists?" },
        { id: "answer-1", role: "user", content: fullAnswer },
      ],
    })
    expect(report.evidence_references).toHaveLength(2)
    expect(report.evidence_references.map((reference) => reference.signal_key)).toEqual([
      "participation", "contribution",
    ])
    for (const reference of report.evidence_references) {
      expect(reference).toMatchObject({
        source_message_id: "answer-1",
        excerpt: fullAnswer,
        preceding_question: "How have you participated with other listeners or artists?",
      })
    }
    expect(report.weak_or_missing_signals).toContain("unasked: not explored in this conversation.")
  })
})
