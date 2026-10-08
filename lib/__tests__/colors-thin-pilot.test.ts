import { describe, expect, it } from "vitest"
import { colorsThinConversationPrompt, colorsThinResponseTool, oneQuestion } from "@/lib/colors-thin-conversation"
import { groundColorsProfile, pendingColorsReport } from "@/lib/colors-post-conversation"

describe("COLORS thin conversation pilot", () => {
  it("sets a loose purpose arc without asking the live model to judge fit", () => {
    const prompt = colorsThinConversationPrompt({
      objective: "Understand how someone might take part in the Forum.",
      turnCount: 3,
      softTarget: 8,
      mediaCatalog: [],
    })
    expect(prompt).toContain("purposes, not required questions or a fixed order")
    expect(prompt).toContain("Skip what is already understood")
    expect(prompt).toContain("Do not ask a second example just to fill a category")
    expect(prompt).toContain("Do not announce stages, score, classify evidence")
    expect(prompt).not.toContain("Make a private advisory judgment")
    expect(Object.keys(colorsThinResponseTool.input_schema.properties)).toEqual([
      "reply", "close", "boundary", "boundaryQuestion", "interactionProposal",
    ])
  })

  it("keeps one model-written invitation when a turn contains two questions", () => {
    expect(oneQuestion("I heard your concern. What are you weighing? Is it the timing?"))
      .toBe("I heard your concern. What are you weighing?")
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
})
