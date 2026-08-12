import { describe, expect, it } from "vitest"
import {
  applicationSignalDefinitions,
  buildCompactApplicationStateMessage,
  collectApplicationSignalAnswers,
  expectedApplicationSignal,
  hasLegacyUntaggedAnswers,
  resolveNextApplicationSignal,
  withCurrentSignalAnswer,
} from "@/lib/application-signal-state"

describe("application signal state", () => {
  const definitions = applicationSignalDefinitions([
    "Why they came",
    "Community contribution",
  ])

  it("creates stable unique keys", () => {
    expect(applicationSignalDefinitions(["Artist reference", "Artist reference"]))
      .toEqual([
        { key: "artist_reference", label: "Artist reference" },
        { key: "artist_reference_2", label: "Artist reference" },
      ])
  })

  it("collects persisted answers and resolves the expected signal", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "What brought you here?",
        metadata: {
          application_next_signal: definitions[0],
        },
      },
      {
        role: "user" as const,
        content: "Community",
        metadata: {
          application_signal: definitions[0],
        },
      },
    ]
    const answers = collectApplicationSignalAnswers(messages, definitions)
    expect(answers).toEqual([{ ...definitions[0], answer: "Community" }])
    expect(expectedApplicationSignal(messages, definitions, answers)).toEqual(
      definitions[0],
    )
    expect(hasLegacyUntaggedAnswers(messages, definitions)).toBe(false)
  })

  it("falls back to transcript mode when previous answers have no signal tag", () => {
    expect(
      hasLegacyUntaggedAnswers(
        [{ role: "user", content: "An older answer", metadata: {} }],
        definitions,
      ),
    ).toBe(true)
  })

  it("builds compact JSON state and advances to the next missing signal", () => {
    const answers = withCurrentSignalAnswer([], definitions[0], "Community")
    const compact = buildCompactApplicationStateMessage({
      definitions,
      answers,
      currentSignal: definitions[0],
      currentQuestion: "What brought you here?",
      currentAnswer: "Community",
      answeredQuestionCount: 1,
      maxQuestions: 9,
      maxFollowupsPerSignal: 2,
    })
    expect(compact).toContain('"why_they_came"')
    expect(compact).toContain('"status": "answered"')
    expect(compact).toContain('"status": "missing"')
    expect(compact).toContain('"questionBudget"')
    expect(compact).toContain('"followupsRemaining": 2')
    expect(compact).toContain('"shouldInvestigate": true')
    expect(compact).toContain('"recommendedNextSignalKey": "why_they_came"')
    expect(compact).toContain("What does that look like in practice?")
    expect(compact).toContain("Do not treat this as optional")
    expect(compact).toContain("Use doorman investigation")
    expect(compact).toContain("interesting concrete details")
    expect(compact).toContain("Keep the exchange conversational")
    expect(compact).toContain("Avoid generic praise")
    expect(
      resolveNextApplicationSignal(null, definitions, answers, definitions[0]),
    ).toEqual(definitions[1])
  })
})
