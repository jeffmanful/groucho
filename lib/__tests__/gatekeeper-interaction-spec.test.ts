import { describe, expect, it } from "vitest"
import {
  DEFAULT_INTERACTION_SPEC,
  interactionSpecForApplicationMove,
  normaliseMediaChoiceAnswer,
  normaliseInteractionSpec,
  validateMediaChoiceAnswer,
} from "@/lib/gatekeeper-interaction-spec"

const mediaChoice = {
  id: "programme-room",
  options: [
    {
      id: "performance-a",
      label: "Performance A",
      media: {
        type: "video",
        provider: "youtube",
        videoId: "abcDEF_1234",
        title: "Performance A — A COLORS SHOW",
        artist: "Artist A",
        thumbnailUrl: "https://images.example.com/a.jpg",
        durationSeconds: 198,
        alt: "Artist A performing in the COLORS studio",
      },
    },
    {
      id: "performance-b",
      label: "Performance B",
      media: {
        type: "video",
        provider: "youtube",
        videoId: "xyzDEF_5678",
        title: "Performance B — A COLORS SHOW",
        alt: "Artist B performing in the COLORS studio",
      },
    },
    {
      id: "performance-c",
      label: "Performance C",
      media: {
        type: "video",
        provider: "youtube",
        videoId: "uvwDEF_9012",
        title: "Performance C — A COLORS SHOW",
        alt: "Artist C performing in the COLORS studio",
      },
    },
  ],
  selection: { mode: "rank", minSelections: 2, maxSelections: 2 },
  rationale: {
    required: true,
    prompt: "What should the room feel?",
    minLength: 12,
    maxLength: 500,
  },
}

describe("normaliseInteractionSpec", () => {
  it("returns model-provided fields for active turns", () => {
    const spec = normaliseInteractionSpec(
      {
        intent: "clarify",
        inputType: "singleSelect",
        options: ["Less than 1 year", "1-3 years"],
        emotionalState: "curious",
        visualState: "curious",
      },
      "none",
    )
    expect(spec).toEqual({
      intent: "clarify",
      inputType: "singleSelect",
      options: ["Less than 1 year", "1-3 years"],
      emotionalState: "curious",
      visualState: "curious",
    })
  })

  it("falls back to text when structured input has no options", () => {
    const spec = normaliseInteractionSpec(
      {
        intent: "probe",
        inputType: "multiSelect",
        emotionalState: "interested",
        visualState: "interested",
      },
      "none",
    )
    expect(spec.inputType).toBe("text")
    expect(spec.options).toBeUndefined()
  })

  it("forces decision-oriented ui on terminal turns", () => {
    const spec = normaliseInteractionSpec(
      {
        intent: "probe",
        inputType: "singleSelect",
        options: ["A", "B"],
        emotionalState: "curious",
        visualState: "curious",
      },
      "pass",
    )
    expect(spec).toEqual({
      intent: "decide",
      inputType: "text",
      emotionalState: "decisive",
      visualState: "decision",
    })
  })

  it("normalises a media choice interaction with video metadata and limits", () => {
    const spec = normaliseInteractionSpec(
      {
        intent: "probe",
        inputType: "mediaChoice",
        emotionalState: "curious",
        visualState: "curious",
        mediaChoice,
      },
      "none",
    )
    expect(spec.inputType).toBe("mediaChoice")
    expect(spec.mediaChoice).toMatchObject({
      id: "programme-room",
      selection: { mode: "rank", minSelections: 2, maxSelections: 2 },
      rationale: { required: true, minLength: 12, maxLength: 500 },
    })
    expect(spec.mediaChoice?.options[0].media.durationSeconds).toBe(198)
  })

  it("falls back to text when a media choice is incomplete", () => {
    const spec = normaliseInteractionSpec(
      { inputType: "mediaChoice", mediaChoice: { id: "broken" } },
      "none",
    )
    expect(spec.inputType).toBe("text")
    expect(spec.mediaChoice).toBeUndefined()
  })

  it("validates and formats an ordered media choice answer", () => {
    const interaction = normaliseInteractionSpec(
      { inputType: "mediaChoice", mediaChoice },
      "none",
    ).mediaChoice!
    const result = validateMediaChoiceAnswer(
      {
        type: "mediaChoice",
        questionId: "programme-room",
        mode: "rank",
        optionIds: ["performance-c", "performance-a"],
        rationale: "The contrast gives the room a clear emotional arc.",
      },
      interaction,
    )
    expect(result).toEqual({
      ok: true,
      answer: {
        type: "mediaChoice",
        questionId: "programme-room",
        mode: "rank",
        optionIds: ["performance-c", "performance-a"],
        rationale: "The contrast gives the room a clear emotional arc.",
      },
      message:
        "Ranked: 1. Performance C; 2. Performance A\nReason: The contrast gives the room a clear emotional arc.",
    })
  })

  it("rejects wrong modes, unknown options, limits, and missing rationale", () => {
    const interaction = normaliseInteractionSpec(
      { inputType: "mediaChoice", mediaChoice },
      "none",
    ).mediaChoice!
    const base = {
      type: "mediaChoice",
      questionId: "programme-room",
      mode: "rank",
      optionIds: ["performance-a", "performance-b"],
      rationale: "A sufficiently detailed reason.",
    }
    expect(validateMediaChoiceAnswer({ ...base, mode: "select" }, interaction).ok).toBe(false)
    expect(
      validateMediaChoiceAnswer(
        { ...base, optionIds: ["performance-a", "unknown"] },
        interaction,
      ).ok,
    ).toBe(false)
    expect(
      validateMediaChoiceAnswer({ ...base, optionIds: ["performance-a"] }, interaction).ok,
    ).toBe(false)
    expect(validateMediaChoiceAnswer({ ...base, rationale: "" }, interaction).ok).toBe(false)
  })

  it("deduplicates answer IDs during normalisation", () => {
    expect(
      normaliseMediaChoiceAnswer({
        type: "mediaChoice",
        questionId: "programme-room",
        mode: "select",
        optionIds: ["performance-a", "performance-a"],
      })?.optionIds,
    ).toEqual(["performance-a"])
  })

  it("uses defaults for invalid tool values on active turns", () => {
    const spec = normaliseInteractionSpec(
      {
        intent: "unknown",
        inputType: "checkbox",
        emotionalState: "happy",
        visualState: "spinning",
      },
      "none",
    )
    expect(spec).toEqual(DEFAULT_INTERACTION_SPEC)
  })

  it("derives application UI posture without model-generated UI fields", () => {
    expect(interactionSpecForApplicationMove("rabbit_hole", "none")).toEqual({
      intent: "probe",
      inputType: "text",
      emotionalState: "interested",
      visualState: "interested",
    })
    expect(interactionSpecForApplicationMove("challenge", "none")).toEqual({
      intent: "challenge",
      inputType: "text",
      emotionalState: "skeptical",
      visualState: "evaluating",
    })
    expect(interactionSpecForApplicationMove("decide", "pass")).toEqual({
      intent: "decide",
      inputType: "text",
      emotionalState: "decisive",
      visualState: "decision",
    })
  })
})
