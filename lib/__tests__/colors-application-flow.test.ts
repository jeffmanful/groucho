import { describe, expect, it } from "vitest"
import { COLORS_ONBOARDING_STEPS } from "@/lib/onboarding-flow-presets"

describe("COLORS application flow", () => {
  it("never asks who received the recommendation", () => {
    const recommendation = COLORS_ONBOARDING_STEPS.find(
      (step) => step.id === "recommendation",
    )
    expect(recommendation?.question.toLowerCase()).not.toMatch(
      /who|recipient|sent (it|music) to/,
    )
  })
})
