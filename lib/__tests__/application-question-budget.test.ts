import { describe, expect, it } from "vitest"
import { applicationQuestionBudget } from "@/lib/application-question-budget"

describe("application question budget", () => {
  it("caps configured flows at nine applicant turns", () => {
    expect(
      applicationQuestionBudget({
        answeredQuestions: 4,
        maxQuestions: 20,
        adaptiveTurnsUsed: 1,
      }),
    ).toMatchObject({ maxQuestions: 9, remainingQuestions: 5, phase: "explore" })
  })

  it("moves through closing, final probe, and hard stop phases", () => {
    expect(
      applicationQuestionBudget({
        answeredQuestions: 7,
        maxQuestions: 9,
        adaptiveTurnsUsed: 0,
      }).phase,
    ).toBe("closing")
    expect(
      applicationQuestionBudget({
        answeredQuestions: 8,
        maxQuestions: 9,
        adaptiveTurnsUsed: 0,
      }).phase,
    ).toBe("final_probe")
    expect(
      applicationQuestionBudget({
        answeredQuestions: 9,
        maxQuestions: 9,
        adaptiveTurnsUsed: 0,
      }).phase,
    ).toBe("hard_stop")
  })

  it("shares three adaptive turns across all goals", () => {
    expect(
      applicationQuestionBudget({
        answeredQuestions: 5,
        maxQuestions: 9,
        adaptiveTurnsUsed: 3,
      }),
    ).toMatchObject({
      adaptiveTurnLimit: 3,
      adaptiveTurnsUsed: 3,
      adaptiveTurnsRemaining: 0,
    })
  })
})
