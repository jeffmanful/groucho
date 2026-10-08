import { describe, expect, it } from "vitest"
import { colorsThinConversationPrompt, colorsThinResponseTool, oneQuestion } from "@/lib/colors-thin-conversation"
import { groundColorsProfile, pendingColorsReport } from "@/lib/colors-post-conversation"
import { COLORS_FORUM_MEMBERSHIP_OBJECTIVE } from "@/lib/colors-forum-membership-brief"
import { COLORS_FORUM_MEMBERSHIP_PROFILE_SCHEMA } from "@/lib/onboarding-persona-template"
import { COLORS_FORUM_MEMBERSHIP_REPORT_VERSION } from "@/lib/reviewer-report"

describe("COLORS thin conversation pilot", () => {
  it("sets a loose purpose arc without asking the live model to judge fit", () => {
    const prompt = colorsThinConversationPrompt({
      objective: COLORS_FORUM_MEMBERSHIP_OBJECTIVE,
      turnCount: 3,
      softTarget: 8,
      mediaCatalog: [],
    })
    expect(prompt).toContain("purposes, not required questions or a fixed order")
    expect(prompt).toContain("Skip what is already understood")
    expect(prompt).toContain("Do not ask a second example just to fill a category")
    expect(prompt).toContain("Do not announce stages, score, classify evidence")
    expect(prompt).toContain("their actual COLORS relationship")
    expect(prompt).toContain("music is something they make, listen to, discuss, discover")
    expect(prompt).toContain("TONES is an optional branch")
    expect(prompt).toContain("TONES is a COLORS series of live events spotlighting a city")
    expect(prompt).toContain("Do not invent details of a particular event")
    expect(prompt).toContain("Online and offline communities matter equally")
    expect(prompt).toContain("Do not redirect an offline story into an online-community check")
    expect(prompt).toContain("Do not treat recognition or attendance as proof of fit")
    expect(prompt).toContain("Never ask for artist permission because someone shares or recommends music")
    expect(prompt).toContain("without staging a disagreement test")
    expect(prompt).toContain("Every non-closing text turn must end with one direct question")
    expect(prompt).toContain("initial Forum is for discussion and sharing external links")
    expect(prompt).not.toContain("Make a private advisory judgment")
    expect(Object.keys(colorsThinResponseTool.input_schema.properties)).toEqual([
      "reply", "close", "boundary", "boundaryQuestion", "interactionProposal",
    ])
  })

  it("profiles forum membership without requiring a named artist or song", () => {
    expect(Object.keys(COLORS_FORUM_MEMBERSHIP_PROFILE_SCHEMA.properties as object)).toEqual([
      "joining_reason", "colors_connection", "music_relationship",
      "community_participation", "tones_connection", "forum_hopes", "initial_participation",
    ])
  })

  it("keeps one model-written invitation when a turn contains two questions", () => {
    expect(oneQuestion("I heard your concern. What are you weighing? Is it the timing?"))
      .toBe("I heard your concern. What are you weighing?")
    expect(oneQuestion("Do you know TONES? It has a particular format."))
      .toBe("Do you know TONES?")
  })

  it("keeps a media choice and its question attached to the applicant's answer for later analysis", () => {
    const report = pendingColorsReport([
      { id: "q1", role: "assistant", content: "Which would you keep, and why?", metadata: {
        ui: { mediaChoice: {
          id: "choice1",
          options: [
            { id: "yt_abc1234", label: "A", media: { type: "video", provider: "youtube", videoId: "abc1234", title: "A", alt: "A" } },
            { id: "yt_def5678", label: "B", media: { type: "video", provider: "youtube", videoId: "def5678", title: "B", alt: "B" } },
          ],
          selection: { mode: "select", minSelections: 1, maxSelections: 1 },
          rationale: { required: true, prompt: "Why this one?", maxLength: 1200 },
        } },
      } },
      { id: "a1", role: "user", content: "I would keep A for its restraint.", metadata: {
        interaction_answer: {
          type: "mediaChoice", questionId: "choice1", mode: "select",
          optionIds: ["yt_abc1234"], rationale: "Its restraint leaves room for the vocal.",
        },
      } },
    ])
    expect(report.evidence_references).toHaveLength(1)
    expect(report.evidence_references[0].preceding_question).toBe("Which would you keep, and why?")
    expect(report.evidence_references[0].interaction).toMatchObject({
      type: "mediaChoice", selected_options: [{ id: "yt_abc1234", label: "A" }],
    })
  })

  it("grounds profile risk flags in audited concerns and omits unknown custom placeholders", () => {
    const profile = groundColorsProfile({
      schema_version: 1,
      core: {
        summary: "Runs a clips page.", sentiment: "neutral", engagement: "medium",
        language: "en", intent_tags: [], interests: [],
        risk_flags: ["ip_concern", "consent_violation"], qa: [], confidence: 0.8,
      },
      custom: { artist_reference: "Not specified in conversation.", intent: "Wants access." },
      extraction: { model: "test", status: "ok" },
    }, [{
      kind: "artist_consent_violation", reason: "", reviewerFlag: "",
      sourceMessageId: "answer-1", quote: "I post without asking first.",
    }], {
      ...pendingColorsReport(),
      detailed_opinion: {
        snapshot: { applicant_summary: "The applicant shares music and joins community discussions.", evidence_reference_ids: [], tags: [] },
        overall_assessment: "", decisive_reasons: [], claim_assessments: [],
        likely_contribution: "", reservations: [], reviewer_questions: [], suggested_human_action: "discuss",
      },
    })
    expect(profile.core?.summary).toBe("The applicant shares music and joins community discussions.")
    expect(profile.core?.risk_flags).toEqual(["artist_consent_violation"])
    expect(profile.custom).toEqual({ intent: "Wants access." })
  })

  it("preserves supported community evidence when the profile extractor omits that field", () => {
    const profile = groundColorsProfile({
      schema_version: 1,
      core: {
        summary: "Listening", sentiment: "positive", engagement: "medium",
        language: "en", intent_tags: [], interests: [], risk_flags: [], qa: [], confidence: 0.7,
      },
      custom: { joining_reason: "Wants to join." },
      extraction: { model: "test", status: "ok" },
    }, [], {
      ...pendingColorsReport(),
      evidence_state: [
        { signal_key: "community_participation", coverage: "supported", source_message_ids: ["answer-1"], material_gap: false, gap_reason: "" },
        { signal_key: "tones_connection", coverage: "unverified", source_message_ids: [], material_gap: false, gap_reason: "" },
      ],
      evidence_references: [{
        signal_key: "community_participation", signal_label: "Community participation",
        source_message_id: "answer-1", excerpt: "I reply in a small music Discord.",
      }],
    })
    expect(profile.custom).toEqual({
      joining_reason: "Wants to join.",
      community_participation: 'Applicant: "I reply in a small music Discord."',
    })
  })

  it("removes an inferred first-step plan and keeps only cited membership fields", () => {
    const profile = groundColorsProfile({
      schema_version: 1,
      core: {
        summary: "Old summary", sentiment: "positive", engagement: "medium",
        language: "en", intent_tags: [], interests: [], risk_flags: [], qa: [], confidence: 0.7,
      },
      custom: {
        joining_reason: "Wants community.",
        initial_participation: "Would begin by reading.",
        tones_connection: "Might attend.",
      },
      extraction: { model: "test", status: "ok" },
    }, [], {
      ...pendingColorsReport(),
      report_version: COLORS_FORUM_MEMBERSHIP_REPORT_VERSION,
      evidence_state: [
        { signal_key: "joining_motivation", coverage: "supported", source_message_ids: ["answer-1"], material_gap: false, gap_reason: "" },
        { signal_key: "forum_participation", coverage: "unverified", source_message_ids: [], material_gap: false, gap_reason: "" },
        { signal_key: "tones_connection", coverage: "unverified", source_message_ids: [], material_gap: false, gap_reason: "" },
      ],
      evidence_references: [{
        signal_key: "joining_motivation", signal_label: "Joining motivation",
        source_message_id: "answer-1", excerpt: "I want a place where people talk about music.",
      }],
    })
    expect(profile.custom).toEqual({
      joining_reason: 'Applicant: "I want a place where people talk about music."',
      forum_hopes: 'Applicant: "I want a place where people talk about music."',
    })
  })
})
