import { describe, expect, it } from "vitest"
import { applicationQuestionBudget } from "@/lib/application-question-budget"

describe("application question budget", () => {
  it("treats the configured turn count as a soft target", () => {
    expect(
      applicationQuestionBudget({
        answeredQuestions: 4,
        maxQuestions: 9,
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
      }).phase,
    ).toBe("explore")
    expect(
      applicationQuestionBudget({
        answeredQuestions: 9,
        maxQuestions: 9,
      }).phase,
    ).toBe("consider_close")
    expect(
      applicationQuestionBudget({
        answeredQuestions: 12,
        maxQuestions: 9,
      }).phase,
    ).toBe("emergency_stop")
  })

})
