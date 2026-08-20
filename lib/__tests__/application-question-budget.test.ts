import { describe, expect, it } from "vitest"
import { applicationQuestionBudget } from "@/lib/application-question-budget"

describe("application question budget", () => {
  it("treats the configured turn count as a soft target", () => {
    expect(
      applicationQuestionBudget({
        answeredQuestions: 4,
        maxQuestions: 9,
        adaptiveTurnsUsed: 1,
      }),
    ).toMatchObject({
      softTarget: 9,
      emergencyLimit: 12,
      maxQuestions: 12,
      remainingQuestions: 8,
      phase: "explore",
    })
  })

  it("does not introduce closing or final-probe phases after answer seven", () => {
    expect(
      applicationQuestionBudget({
        answeredQuestions: 7,
        maxQuestions: 9,
        adaptiveTurnsUsed: 0,
      }).phase,
    ).toBe("explore")
    expect(
      applicationQuestionBudget({
        answeredQuestions: 9,
        maxQuestions: 9,
        adaptiveTurnsUsed: 0,
      }).phase,
    ).toBe("consider_close")
    expect(
      applicationQuestionBudget({
        answeredQuestions: 12,
        maxQuestions: 9,
        adaptiveTurnsUsed: 0,
      }).phase,
    ).toBe("emergency_stop")
  })

  it("does not apply a separate global adaptive-turn cap", () => {
    expect(
      applicationQuestionBudget({
        answeredQuestions: 5,
        maxQuestions: 9,
        adaptiveTurnsUsed: 3,
      }),
    ).toMatchObject({
      adaptiveTurnsUsed: 3,
      phase: "explore",
    })
  })
})
