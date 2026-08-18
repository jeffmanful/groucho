import { describe, expect, it } from "vitest"
import {
  applicationSignalDefinitions,
  buildCompactApplicationStateMessage,
  collectApplicationSignalAnswers,
  expectedApplicationSignal,
  hasLegacyUntaggedAnswers,
  resolveNextApplicationSignal,
  withCoveredSignalAnswers,
  withCurrentSignalAnswer,
} from "@/lib/application-signal-state"

describe("application signal state", () => {
  const definitions = applicationSignalDefinitions([
    "Why they came",
    "Community contribution",
  ])

  it("creates stable unique keys", () => {
    const result = applicationSignalDefinitions(["Artist reference", "Artist reference"])
    expect(result.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "artist_reference", label: "Artist reference" },
      { key: "artist_reference_2", label: "Artist reference" },
    ])
    expect(result[0].goal).toContain("evidence for")
    expect(result[0].promptRoutes).toEqual(["Artist reference"])
    expect(result[0]).toMatchObject({ priority: "core", cluster: "artist_reference" })
  })

  it("groups related COLORS goals and distinguishes core from supporting evidence", () => {
    const goals = applicationSignalDefinitions([
      "What brought you here?",
      "Name an artist more people should know about.",
      "What's the last song you recommended?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
    expect(goals.map(({ priority }) => priority)).toEqual([
      "supporting",
      "core",
      "supporting",
      "core",
      "core",
    ])
    expect(goals[1].cluster).toBe(goals[2].cluster)
    expect(goals[3].cluster).toBe(goals[4].cluster)
    expect(goals[2].promptRoutes[0]).toBe(
      "What is one of their songs that you have—or would—share with someone, and why?",
    )
  })

  it("points contextual bridges at existing evidence goals", () => {
    const goals = applicationSignalDefinitions([
      "Name an artist more people should know about.",
      "What's the last song you recommended?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
    const compact = buildCompactApplicationStateMessage({
      definitions: goals,
      answers: [],
      currentSignal: goals[0],
      currentQuestion: "Whose work stays with you?",
      currentAnswer: "I keep returning to their album.",
    })
    expect(compact).toContain(
      `"preferredNextSignalKey": "${goals[1].key}"`,
    )
    expect(compact).toContain('"candidateSignalKeys"')
    for (const goal of goals) {
      expect(compact).toContain(`"${goal.key}"`)
    }
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
    expect(answers).toEqual([{ ...definitions[0], answer: "Community", covered: true }])
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
      conversationThread: {
        subject: "Artistic restraint",
        strongestDetail: "Space between releases protects the work",
        openHook: "Visibility could alter the work",
        momentum: "high",
        applicantEnergy: "engaged",
        acknowledgedDetails: ["Space between releases"],
      },
      responseModeHistory: {
        recentModes: ["reflect", "connect", "connect"],
        lastMode: "connect",
        repeatedModeCount: 2,
      },
      bridgeHistory: {
        recentKinds: ["person_to_work", "work_to_detail"],
        lastKind: "work_to_detail",
        repeatedKindCount: 1,
      },
    })
    expect(compact).toContain('"why_they_came"')
    expect(compact).toContain('"status": "covered"')
    expect(compact).toContain('"status": "open"')
    expect(compact).toContain('"questionBudget"')
    expect(compact).toContain('"phase": "explore"')
    expect(compact).toContain('"adaptiveTurnLimit": 3')
    expect(compact).toContain('"followupsRemaining": 2')
    expect(compact).toContain('"conversationDepth"')
    expect(compact).toContain('"recentQualities": []')
    expect(compact).toContain("Assess the current answer semantically")
    expect(compact).toContain("A short but specific answer may be usable or rich")
    expect(compact).toContain("open_door")
    expect(compact).toContain("rabbit_hole")
    expect(compact).toContain("Keep the exchange conversational")
    expect(compact).toContain("Avoid generic praise")
    expect(compact).toContain("One answer can cover several goals")
    expect(compact).toContain("suggestedGapSignalKey")
    expect(compact).toContain('"subject": "Artistic restraint"')
    expect(compact).toContain("continue that thread before filling an unrelated goal")
    expect(compact).toContain('"repeatedModeCount": 2')
    expect(compact).toContain("Do not mechanically produce")
    expect(compact).toContain('"priorityConversationBridges"')
    expect(compact).toContain('"artistToSong"')
    expect(compact).toContain("Keep the artist as the subject")
    expect(compact).toContain('"albumMention"')
    expect(compact).toContain("which song from that album")
    expect(compact).toContain('"applicantMakesMusic"')
    expect(compact).toContain("do not glide past it")
    expect(compact).toContain('"bridgeGrammar"')
    expect(compact).toContain('"lastKind": "work_to_detail"')
    expect(compact).toContain("generate up to three bridgeCandidates")
    expect(compact).toContain("maker_to_practice bridge into an open core goal outranks")
    expect(compact).toContain("Render the bridge without narrating it")
    expect(compact).toContain("let me shift")
    expect(compact).toContain("Do not stack separate asks")
    expect(
      resolveNextApplicationSignal(null, definitions, answers, definitions[0]),
    ).toEqual(definitions[1])
  })

  it("lets one answer cover several evidence goals", () => {
    const goals = applicationSignalDefinitions([
      "What brought you here?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
    const answers = collectApplicationSignalAnswers([
      {
        role: "user",
        content: "I run a listening group and would host one here too.",
        metadata: {
          application_signal: { key: goals[0].key },
          application_signals: [
            { key: goals[1].key },
            { key: goals[2].key },
          ],
        },
      },
    ], goals)
    expect(answers.map((answer) => [answer.key, answer.covered])).toEqual([
      [goals[0].key, false],
      [goals[1].key, true],
      [goals[2].key, true],
    ])
    expect(resolveNextApplicationSignal(goals[0].key, goals, answers, null)).toEqual(goals[0])
  })

  it("does not immediately ask for an incidental goal covered on the same turn", () => {
    const goals = applicationSignalDefinitions(["Motivation", "Participation", "Contribution"])
    const attempted = withCurrentSignalAnswer([], goals[0], "I host a monthly group.", false)
    const covered = withCoveredSignalAnswers(
      attempted,
      [goals[1], goals[2]],
      "I host a monthly group.",
    )
    expect(resolveNextApplicationSignal(goals[1].key, goals, covered, null)).toEqual(goals[0])
  })
})
