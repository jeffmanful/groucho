import { describe, expect, it } from "vitest"
import { COLORS_ONBOARDING_STEPS } from "@/lib/onboarding-flow-presets"

describe("COLORS application flow", () => {
  it("uses the approved six-question sequence", () => {
    expect(COLORS_ONBOARDING_STEPS.map((step) => step.question)).toEqual([
      "What brought you here?",
      "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
      "What's the last song you recommended, and why did you think it was worth sharing?",
      "Someone shares unfinished music that isn't really for you. How would you respond?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
  })

  it("never asks who received the recommendation", () => {
    const recommendation = COLORS_ONBOARDING_STEPS.find(
      (step) => step.id === "recommendation",
    )
    expect(recommendation?.question.toLowerCase()).not.toMatch(
      /who|recipient|sent (it|music) to/,
    )
  })

  it("keeps the configured participation options", () => {
    const participation = COLORS_ONBOARDING_STEPS.find(
      (step) => step.id === "participation_style",
    )
    expect(participation?.interaction).toEqual({
      inputType: "singleSelect",
      options: [
        "I mostly listen",
        "I like discussing music",
        "I enjoy giving feedback",
        "I regularly share discoveries",
      ],
    })
  })
})
