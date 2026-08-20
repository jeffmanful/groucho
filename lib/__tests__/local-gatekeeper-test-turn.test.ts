import { describe, expect, it } from "vitest"
import { applicationSignalDefinitions } from "@/lib/application-signal-state"
import {
  createLocalGatekeeperTestTurn,
  inferLocalGatekeeperAnswers,
  localGatekeeperTestSignalDefinitions,
} from "@/lib/local-gatekeeper-test-turn"

const definitions = applicationSignalDefinitions([
  "What brought you here?",
  "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
  "Someone shares unfinished music that isn't really for you. How would you respond?",
])

describe("createLocalGatekeeperTestTurn", () => {
  it("uses the default COLORS test sequence when no project signals are configured", () => {
    const localDefinitions = localGatekeeperTestSignalDefinitions([])
    const turn = createLocalGatekeeperTestTurn({
      definitions: localDefinitions,
      answers: [
        {
          ...localDefinitions[0],
          answer:
            "I want to be around people who take new music seriously and can give artists useful context.",
        },
      ],
      currentSignal: localDefinitions[0],
      userAnswerCount: 1,
      maxTurns: 9,
    })

    expect(localDefinitions).toHaveLength(7)
    expect(turn.structuredTerminal).toBe("none")
    expect(turn.parsedNextSignalKey).toBe(localDefinitions[1]?.key)
    expect(turn.assistantContent).toContain("how people listen")
    expect(turn.assistantContent).toContain(
      "why does COLORS feel like the right one",
    )
  })

  it("can infer answers from sessions that failed before metadata was written", () => {
    const inferred = inferLocalGatekeeperAnswers({
      definitions,
      messages: [
        { role: "assistant", content: definitions[0].label },
        {
          role: "user",
          content:
            "I run a small listening group where people bring new releases and talk about context.",
        },
        { role: "user", content: "I would point people toward Liv.e." },
      ],
    })

    expect(inferred.answers).toHaveLength(2)
    expect(inferred.answers[0]?.key).toBe(definitions[0].key)
    expect(inferred.answers[1]?.key).toBe(definitions[1].key)
    expect(inferred.currentSignal?.key).toBe(definitions[1].key)
  })

  it("asks the next configured signal during local test mode", () => {
    const turn = createLocalGatekeeperTestTurn({
      definitions,
      answers: [
        {
          ...definitions[0],
          answer:
            "I help run a small listening group where people bring new releases and talk about what the artist is trying to build.",
        },
      ],
      currentSignal: definitions[0],
      userAnswerCount: 1,
      maxTurns: 9,
    })

    expect(turn.structuredTerminal).toBe("none")
    expect(turn.parsedNextSignalKey).toBe(definitions[1].key)
    expect(turn.assistantContent).toContain("made a space around music")
    expect(turn.assistantContent).toContain(definitions[1].label)
  })

  it("asks a follow-up when the current answer has insufficient evidence", () => {
    const turn = createLocalGatekeeperTestTurn({
      definitions,
      answers: [{ ...definitions[0], answer: "idk" }],
      currentSignal: definitions[0],
      userAnswerCount: 1,
      maxTurns: 9,
    })

    expect(turn.structuredTerminal).toBe("none")
    expect(turn.parsedNextSignalKey).toBe(definitions[0].key)
    expect(turn.assistantContent).toContain("concrete example")
  })

  it("treats maxTurns as a soft target and closes only at the emergency limit", () => {
    const answer = { ...definitions[0], answer: "idk" }
    const atSoftTarget = createLocalGatekeeperTestTurn({
      definitions,
      answers: [answer],
      currentSignal: definitions[0],
      userAnswerCount: 9,
      maxTurns: 9,
    })
    const atEmergencyLimit = createLocalGatekeeperTestTurn({
      definitions,
      answers: [answer],
      currentSignal: definitions[0],
      userAnswerCount: 12,
      maxTurns: 9,
    })

    expect(atSoftTarget.structuredTerminal).toBe("none")
    expect(atSoftTarget.parsedNextSignalKey).toBe(definitions[0].key)
    expect(atEmergencyLimit.structuredTerminal).not.toBe("none")
    expect(atEmergencyLimit.parsedNextSignalKey).toBeNull()
  })

  it("concludes with a private reviewer report when the local test flow ends", () => {
    const turn = createLocalGatekeeperTestTurn({
      definitions,
      answers: definitions.map((signal) => ({
        ...signal,
        answer:
          "I hosted a monthly feedback session for local artists, wrote context notes for each track, and introduced two collaborators who later released work together.",
      })),
      currentSignal: definitions[2],
      userAnswerCount: 3,
      maxTurns: 9,
    })

    expect(turn.structuredTerminal).toBe("pass")
    expect(turn.reviewerReport?.advisory_recommendation).toBe("recommend")
    expect(turn.reviewerReport?.confidence_score).toBeGreaterThan(0.6)
  })
})
