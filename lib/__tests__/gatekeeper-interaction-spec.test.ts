import { describe, expect, it } from "vitest"
import {
  DEFAULT_INTERACTION_SPEC,
  interactionSpecForApplicationMove,
  normaliseInteractionSpec,
} from "@/lib/gatekeeper-interaction-spec"

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
