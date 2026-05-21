import { describe, expect, it } from "vitest"
import {
  stepFieldsFromQuestion,
  stepsFromQuestionLines,
  stepsFromSimpleQuestions,
  syncQuestionTextsToSteps,
} from "@/lib/onboarding-flow-helpers"

describe("stepFieldsFromQuestion", () => {
  it("derives id and profile_key from question text", () => {
    const s = stepFieldsFromQuestion("What draws you to COLORS?", 0)
    expect(s.question).toBe("What draws you to COLORS?")
    expect(s.id).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(s.profile_key).toMatch(/^[a-z][a-z0-9_]*$/)
  })
})

describe("stepsFromQuestionLines", () => {
  it("parses one question per line", () => {
    const steps = stepsFromQuestionLines(
      "First question?\n\nSecond question?",
    )
    expect(steps).toHaveLength(2)
    expect(steps[0].question).toBe("First question?")
    expect(steps[1].question).toBe("Second question?")
  })
})

describe("syncQuestionTextsToSteps", () => {
  it("updates question text without changing step id", () => {
    const prev = [
      {
        id: "intent",
        title: "Intent",
        question: "Old?",
        profile_key: "intent",
        required: true,
      },
    ]
    const next = syncQuestionTextsToSteps(["New question?"], prev)
    expect(next[0].id).toBe("intent")
    expect(next[0].profile_key).toBe("intent")
    expect(next[0].question).toBe("New question?")
  })
})

describe("stepsFromSimpleQuestions", () => {
  it("keeps slot count when a question is cleared mid-edit", () => {
    const prev = [
      {
        id: "a",
        title: "A",
        question: "First?",
        profile_key: "a",
        required: true,
      },
      {
        id: "b",
        title: "B",
        question: "Second?",
        profile_key: "b",
        required: true,
      },
    ]
    const next = stepsFromSimpleQuestions(["First?", ""], prev)
    expect(next).toHaveLength(2)
    expect(next[1].id).toBe("b")
  })

  it("reuses previous step when question unchanged", () => {
    const prev = [
      {
        id: "intent",
        title: "Intent",
        question: "Why join?",
        profile_key: "intent",
        required: true,
      },
    ]
    const next = stepsFromSimpleQuestions(["Why join?"], prev)
    expect(next[0].id).toBe("intent")
  })
})
