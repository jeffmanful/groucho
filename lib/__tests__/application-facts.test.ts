import { describe, expect, it } from "vitest"
import {
  collectApplicationFacts,
  normaliseApplicationActivityClaims,
  normaliseMediaClaim,
} from "@/lib/application-facts"

const mediaChoice = {
  id: "programme-room",
  options: ["a", "b", "c", "d"].map((id) => ({
    id,
    label: `Performance ${id}`,
    media: {
      type: "video",
      provider: "youtube",
      videoId: `${id}bcdef12345`,
      title: `Performance ${id}`,
      alt: `Artist ${id} performing`,
    },
  })),
  selection: { mode: "remove", minSelections: 1, maxSelections: 1 },
  rationale: { required: true, prompt: "Why?", minLength: 8, maxLength: 500 },
}

describe("source-linked application facts", () => {
  it("carries retained works without inventing an order, and records one depth turn", () => {
    const facts = collectApplicationFacts([
      {
        id: "question",
        role: "assistant",
        content: "Which would you remove?",
        metadata: { ui: { mediaChoice } },
      },
      {
        id: "choice",
        role: "user",
        content: "I would remove A; I have not listened closely to the transitions.",
        metadata: {
          interaction_answer: {
            type: "mediaChoice",
            questionId: "programme-room",
            mode: "remove",
            optionIds: ["a"],
          },
          application_media_claim: {
            kind: "not_yet_listened_closely",
            quote: "I have not listened closely to the transitions",
            sourceMessageId: "choice",
          },
        },
      },
      {
        id: "followup",
        role: "assistant",
        content: "What would you test?",
        metadata: { application_media_depth_followup: true },
      },
      {
        id: "correction",
        role: "user",
        content: "I did not order them. Can we move on?",
        metadata: {
          application_process_feedback: {
            kind: "corrects_assistant_assumption",
            sourceMessageId: "correction",
          },
        },
      },
    ])

    expect(facts.mediaChoice).toMatchObject({
      mode: "remove",
      sourceMessageId: "choice",
      selectedOptionIds: ["a"],
      retainedOptionIds: ["b", "c", "d"],
      explicitOrderOptionIds: null,
      depthFollowupUsed: true,
      applicantClaims: [{
        kind: "not_yet_listened_closely",
        sourceMessageId: "choice",
        quote: "I have not listened closely to the transitions",
      }],
    })
    expect(facts.processFeedback).toEqual([
      { kind: "corrects_assistant_assumption", sourceMessageId: "correction" },
    ])
  })

  it("rejects model claims without an exact applicant quote", () => {
    expect(normaliseMediaClaim({
      kind: "provisional_choice",
      quote: "I sequenced these three works",
    }, "I kept three, but have not heard them together.")).toEqual({
      kind: "none",
      quote: "",
    })
  })

  it("keeps an explicit topic-change request when the relation also says clarification", () => {
    const facts = collectApplicationFacts([{
      id: "move-on",
      role: "user",
      content: "We've covered that; can we discuss something else?",
      metadata: {
        application_answer_relation: { kind: "clarification_request" },
        application_process_feedback: { kind: "requests_topic_change" },
      },
    }])
    expect(facts.processFeedback).toEqual([
      { kind: "requests_topic_change", sourceMessageId: "move-on" },
    ])
  })

  it("carries quoted one-off, ongoing, and proposed activity without upgrading their status", () => {
    const proposed = "I would start a monthly circle using public performances."
    const oneOff = "I hosted one listening night with a few friends."
    const correction = "That was one night, not the first meeting of a circle."
    const facts = collectApplicationFacts([
      {
        id: "plan",
        role: "user",
        content: proposed,
        metadata: { application_activity_claims: [
          { status: "proposed", quote: proposed, sourceMessageId: "plan" },
        ] },
      },
      {
        id: "example",
        role: "user",
        content: `${oneOff} I often replay a phrase on my own.`,
        metadata: { application_activity_claims: [
          { status: "one_off", quote: oneOff, sourceMessageId: "example" },
          { status: "ongoing", quote: "I often replay a phrase on my own.", sourceMessageId: "example" },
        ] },
      },
      {
        id: "correction",
        role: "user",
        content: correction,
        metadata: { application_activity_claims: [
          { status: "one_off", quote: correction, sourceMessageId: "correction" },
        ] },
      },
    ])

    expect(facts.activityClaims).toEqual([
      { status: "proposed", quote: proposed, sourceMessageId: "plan" },
      { status: "one_off", quote: oneOff, sourceMessageId: "example" },
      { status: "ongoing", quote: "I often replay a phrase on my own.", sourceMessageId: "example" },
      { status: "one_off", quote: correction, sourceMessageId: "correction" },
    ])
    expect(normaliseApplicationActivityClaims([
      { status: "ongoing", quote: "I run the circle every month." },
    ], correction)).toEqual([])
  })
})
