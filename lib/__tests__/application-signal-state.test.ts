import { describe, expect, it } from "vitest"
import {
  applicationSignalDefinitions,
  applicationSignalDefinitionsForEvidence,
  applicationSignalDefinitionsForOrientation,
  buildCompactApplicationStateMessage,
  collectApplicationRelevantSignalKeys,
  newlyCoveredApplicationSignalKeys,
  collectApplicationInsufficientEvidenceKeys,
  collectApplicationSignalAnswers,
  expectedApplicationSignal,
  hasLegacyUntaggedAnswers,
  resolveNextApplicationSignal,
  shouldDeferApplicationTerminal,
  withCoveredSignalAnswers,
  withCurrentSignalAnswer,
} from "@/lib/application-signal-state"

describe("application signal state", () => {
  const definitions = applicationSignalDefinitions([
    "Why they came",
    "Community contribution",
  ])

  it("recovers participation from an exact earlier applicant message, not a clarification request", () => {
    const participation = definitions[1]
    const answers = collectApplicationSignalAnswers([
      {
        id: "earlier-participation",
        role: "user",
        content: "I host a monthly listening night and introduce the artists to each other.",
      },
      {
        id: "clarification",
        role: "user",
        content: "Is that a question?",
        metadata: { application_answer_relation: { kind: "clarification_request" } },
      },
      {
        id: "audited-turn",
        role: "assistant",
        content: "What would you test next?",
        metadata: {
          application_recovered_signal_evidence: {
            signalKey: participation.key,
            sourceMessageId: "earlier-participation",
          },
        },
      },
    ], definitions)

    expect(answers).toEqual(expect.arrayContaining([expect.objectContaining({
      key: participation.key,
      covered: true,
      sources: [expect.objectContaining({ messageId: "earlier-participation" })],
    })]))
    expect(answers.find((answer) => answer.key === participation.key)?.answer)
      .not.toContain("Is that a question?")
  })

  it("does not count an applicant correction as a signal answer", () => {
    const messages = [{
      id: "correction",
      role: "user" as const,
      content: "I did not sequence those works; please move on.",
      metadata: {
        application_process_feedback: { kind: "corrects_assistant_assumption" },
        application_signal: { key: definitions[0].key, label: definitions[0].label },
        answer_assessment: { quality: "usable" },
      },
    }]
    expect(collectApplicationSignalAnswers(messages, definitions)).toEqual([])
    expect(hasLegacyUntaggedAnswers(messages, definitions)).toBe(false)
  })

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
      "What is one of their songs that you have shared with someone, and why?",
    )
  })

  it("keeps orientation descriptive and accepts model-recorded conditional relevance", () => {
    const goals = applicationSignalDefinitions([
      "What brought you here?",
      "Name an artist more people should know about.",
      "What's the last song you recommended?",
      "Someone shares unfinished music that isn't really for you. How would you respond?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
    const artist = applicationSignalDefinitionsForOrientation(goals, {
      primary: "artist",
      scores: { artist: 0.9, curator: 0.1, enthusiast: 0.2 },
      confidence: 0.9,
      evidence: ["Makes music"],
    })
    const curator = applicationSignalDefinitionsForOrientation(goals, {
      primary: "curator",
      scores: { artist: 0.1, curator: 0.9, enthusiast: 0.2 },
      confidence: 0.9,
      evidence: ["Curates events"],
    })
    const enthusiast = applicationSignalDefinitionsForOrientation(goals, {
      primary: "enthusiast",
      scores: { artist: 0.05, curator: 0.05, enthusiast: 0.9 },
      confidence: 0.9,
      evidence: ["Mostly listens"],
    })

    expect(artist.map((signal) => signal.key)).toEqual(goals.map((signal) => signal.key))
    expect(curator.map((signal) => signal.key)).toEqual(goals.map((signal) => signal.key))
    expect(enthusiast.map((signal) => signal.key)).toEqual(goals.map((signal) => signal.key))
    expect(artist.some((signal) => signal.cluster === "care_and_feedback")).toBe(true)
    expect(enthusiast.some((signal) => signal.cluster === "care_and_feedback")).toBe(true)
    expect(curator.some((signal) => signal.cluster === "care_and_feedback")).toBe(true)
    expect(goals[1]).toMatchObject({
      key: "colors_relationship",
      cluster: "colors_relationship",
      priority: "core",
    })
    expect(artist.map((signal) => signal.promptRoutes)).toEqual(
      curator.map((signal) => signal.promptRoutes),
    )

    const feedbackKey = goals.find(
      (signal) => signal.cluster === "care_and_feedback",
    )!.key
    const listenerEvidence = applicationSignalDefinitionsForEvidence(goals)
    const brandAdmiration = applicationSignalDefinitionsForEvidence(goals)
    const feedbackEvidence = applicationSignalDefinitionsForEvidence(
      goals,
      [feedbackKey],
    )
    expect(
      listenerEvidence.some((signal) => signal.cluster === "care_and_feedback"),
    ).toBe(false)
    expect(
      brandAdmiration.some((signal) => signal.cluster === "care_and_feedback"),
    ).toBe(false)
    expect(
      feedbackEvidence.some((signal) => signal.cluster === "care_and_feedback"),
    ).toBe(true)
  })

  it("ignores unknown relevance keys and opens a known conditional key", () => {
    const goals = applicationSignalDefinitions([
      "What brought you here?",
      "Name an artist more people should know about.",
      "Someone shares unfinished music that isn't really for you. How would you respond?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
    const feedbackKey = goals.find(
      (signal) => signal.cluster === "care_and_feedback",
    )!.key
    const relevant = applicationSignalDefinitionsForEvidence(
      goals,
      ["invented_key", feedbackKey],
    )

    expect(
      relevant.some((signal) => signal.cluster === "care_and_feedback"),
    ).toBe(true)
  })

  it("routes a listener towards participation and contribution instead of feedback", () => {
    const goals = applicationSignalDefinitions([
      "What brought you here?",
      "Name an artist more people should know about.",
      "What's the last song you recommended?",
      "Someone shares unfinished music that isn't really for you. How would you respond?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
    const listenerGoals = applicationSignalDefinitionsForEvidence(
      applicationSignalDefinitionsForOrientation(goals, {
        primary: "enthusiast",
        scores: { artist: 0.05, curator: 0.05, enthusiast: 0.9 },
        confidence: 0.9,
        evidence: ["Mostly listens"],
      }),
      [],
    )
    const participation = listenerGoals.find((signal) =>
      signal.label.includes("Which sounds"),
    )!
    const covered = listenerGoals
      .filter(
        (signal) =>
          signal.key !== participation.key &&
          !signal.label.toLowerCase().includes("contribute"),
      )
      .map((signal) => ({
        ...signal,
        answer: "Covered answer",
        covered: true,
      }))
    const afterParticipation = [
      ...covered,
      { ...participation, answer: "I mostly listen", covered: true },
    ]
    const next = resolveNextApplicationSignal(
      null,
      listenerGoals,
      afterParticipation,
      null,
    )

    expect(listenerGoals.some((signal) => signal.cluster === "care_and_feedback")).toBe(false)
    expect(next?.label).toContain("contribute")
    expect(next?.promptRoutes[0]).toContain("giving back")
    expect(
      shouldDeferApplicationTerminal({
        terminalRequested: true,
        phase: "explore",
        currentAnswerConcerning: false,
        answeredQuestions: 1,
        remainingQuestions: 2,
        definitions: listenerGoals,
        answers: afterParticipation,
      }),
    ).toBe(true)
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
      `"preferredNextSignalKey":"${goals[1].key}"`,
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
        id: "msg-community",
        role: "user" as const,
        content: "Community",
        metadata: {
          application_signal: definitions[0],
        },
      },
    ]
    const answers = collectApplicationSignalAnswers(messages, definitions)
    expect(answers).toEqual([{
      ...definitions[0],
      answer: "Community",
      covered: true,
      sources: [{ messageId: "msg-community", excerpt: "Community" }],
    }])
    expect(expectedApplicationSignal(messages, definitions, answers)).toEqual(
      definitions[0],
    )
    expect(hasLegacyUntaggedAnswers(messages, definitions)).toBe(false)
  })

  it("does not record a request for clarification as application evidence", () => {
    const answers = collectApplicationSignalAnswers([{
      id: "msg-clarify",
      role: "user",
      content: "Is that a question?",
      metadata: {
        application_signal: definitions[0],
        application_signals: [],
        application_answer_relation: {
          kind: "clarification_request",
          reason: "Asks for the prompt to be made clear.",
        },
      },
    }], definitions)
    expect(answers).toEqual([])
  })

  it("collects only configured model-recorded relevance keys", () => {
    const messages = [{
      role: "user" as const,
      content: "I facilitate careful exchanges around unfinished work.",
      metadata: {
        application_relevant_signals: [
          definitions[1],
          { key: "invented", label: "Invented" },
        ],
      },
    }]

    expect([
      ...collectApplicationRelevantSignalKeys(messages, definitions),
    ]).toEqual([definitions[1].key])
  })

  it("accepts only newly covered configured keys for the current message", () => {
    expect(
      newlyCoveredApplicationSignalKeys(
        [definitions[0].key, definitions[1].key, definitions[1].key, "invented"],
        definitions,
        [{
          ...definitions[0],
          answer: "Earlier evidence",
          covered: true,
        }],
      ),
    ).toEqual([definitions[1].key])
  })

  it("carries recent unclassified applicant facts into the compact prompt", () => {
    const compact = buildCompactApplicationStateMessage({
      definitions: [],
      answers: [],
      currentSignal: null,
      currentQuestion: "How do you participate?",
      currentAnswer: "Mostly I listen.",
      recentApplicantAnswers: [
        "I sent a friend a song last week and wrote one sentence about the vocal.",
      ],
    })
    expect(compact).toContain("I sent a friend a song last week")
    expect(compact).toContain("Do not ask them to restate one")
  })

  it("falls back to transcript mode when previous answers have no signal tag", () => {
    expect(
      hasLegacyUntaggedAnswers(
        [{ role: "user", content: "An older answer", metadata: {} }],
        definitions,
      ),
    ).toBe(true)
  })

  it("keeps deliberate conversational thread turns out of legacy fallback", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: "What kind of music are you making?",
        metadata: { application_conversation_thread_turn: true },
      },
      {
        role: "user" as const,
        content: "I make cinematic soundtracks.",
        metadata: {},
      },
    ]

    expect(hasLegacyUntaggedAnswers(messages, definitions)).toBe(false)
    expect(expectedApplicationSignal(messages, definitions, [])).toBeNull()
  })

  it("keeps the COLORS orientation playbook out of unrelated applications", () => {
    const compact = buildCompactApplicationStateMessage({
      definitions,
      answers: [],
      currentSignal: definitions[0],
      currentQuestion: "Why are you applying?",
      currentAnswer: "To learn.",
    })
    expect(compact).not.toContain("orientationLenses")
    expect(compact).not.toContain("Update participantOrientation")
  })

  it("suggests an uncovered COLORS relationship after the opening without requiring it as a separate question", () => {
    const goals = applicationSignalDefinitions([
      "What brought you here?",
      "Name an artist more people should know about.",
      "What's the last song you recommended?",
      "Someone shares unfinished music that isn't really for you. How would you respond?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?",
    ])
    const orientation = goals.find((signal) => signal.cluster === "orientation")!
    const relationship = goals.find(
      (signal) => signal.cluster === "colors_relationship",
    )!
    const compact = buildCompactApplicationStateMessage({
      definitions: goals,
      answers: withCurrentSignalAnswer(
        [],
        orientation,
        "I want a community around music.",
      ),
      currentSignal: orientation,
      currentQuestion: "Why do you want to be an early applicant for the Forum?",
      currentAnswer: "I want a community around music.",
      adaptiveOrientationEnabled: true,
    })

    expect(compact).toContain(
      `"suggestedGapSignalKey":"${relationship.key}"`,
    )
    expect(compact).toContain(
      "Relationship to COLORS is a high-priority early intent, not a compulsory second question",
    )
    expect(compact).toContain(
      "Treat sustained reciprocity as part of participation and contribution",
    )
    expect(compact).toContain(
      "Treat situated cultural perspective as an enhancement",
    )
    expect(compact).toContain('"localSceneContext"')
    expect(compact).toContain('"roleCrossover"')
    expect(compact).toContain("overlapping, changing facets")
    expect(compact).toContain("Do not rewrite aspiration as established practice")
    expect(compact).toContain("Do not ask for an exact location")
    expect(compact).toContain('"orientationLenses"')
    expect(compact).toContain("Descriptive context only")
    expect(compact).toContain('"relevance":"conditional"')
    expect(compact).toContain(
      "Never add, remove, force, or prioritise an evidence goal because of participantOrientation",
    )

    const coveredTogether = withCoveredSignalAnswers(
      withCurrentSignalAnswer(
        [],
        orientation,
        "COLORS showed me how much a simple setting can reveal in a performance.",
      ),
      [relationship],
      "COLORS showed me how much a simple setting can reveal in a performance.",
    )
    expect(coveredTogether.find((answer) => answer.key === relationship.key)).toMatchObject({
      covered: true,
    })
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
      adaptiveOrientationEnabled: true,
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
    expect(compact).toContain('"status":"covered"')
    expect(compact).toContain('"status":"open"')
    expect(compact).toContain('"questionBudget"')
    expect(compact).toContain('"phase":"explore"')
    expect(compact).toContain('"softTarget":9')
    expect(compact).toContain('"emergencyLimit":12')
    expect(compact).toContain('"exampleQuestions"')
    expect(compact).toContain('"followupsRemaining":2')
    expect(compact).toContain('"conversationDepth"')
    expect(compact).toContain('"recentQualities":[]')
    expect(compact).toContain("Assess the current answer semantically")
    expect(compact).toContain("Treat participantOrientation as read-only context")
    expect(compact).toContain("Listening is a valid orientation")
    expect(compact).toContain("Use usable as the normal baseline")
    expect(compact).toContain("Reserve thin for genuinely empty")
    expect(compact).toContain("open_door")
    expect(compact).toContain("rabbit_hole")
    expect(compact).toContain("Keep the exchange conversational")
    expect(compact).toContain("Avoid generic praise")
    expect(compact).toContain("One answer can cover several goals")
    expect(compact).toContain("suggestedGapSignalKey")
    expect(compact).toContain('"subject":"Artistic restraint"')
    expect(compact).toContain("continue that thread before filling an unrelated goal")
    expect(compact).toContain('"repeatedModeCount":2')
    expect(compact).toContain("Do not mechanically produce")
    expect(compact).toContain('"priorityConversationBridges"')
    expect(compact).toContain('"artistToSong"')
    expect(compact).toContain("Keep the artist as the subject")
    expect(compact).toContain('"albumMention"')
    expect(compact).toContain("which song from that album")
    expect(compact).toContain('"applicantMakesMusic"')
    expect(compact).toContain("do not glide past it")
    expect(compact).toContain('"bridgeGrammar"')
    expect(compact).toContain('"lastKind":"work_to_detail"')
    expect(compact).toContain("use at most one meaningful bridge")
    expect(compact).toContain("receive → connect → invite")
    expect(compact).toContain(
      "Make the relationship you choose internally explain why the next turn follows",
    )
    expect(compact).toContain("maker_to_practice bridge into an open core goal outranks")
    expect(compact).toContain("ground the bridge in the applicant's concrete verb or action")
    expect(compact).toContain("What would you actually do with that in the Forum?")
    expect(compact).toContain("how would that show up")
    expect(compact).toContain("Make the bridge felt without narrating the mechanics")
    expect(compact).toContain("continue: stay inside the current subject")
    expect(compact).toContain("connect: name or clearly reuse one concrete detail")
    expect(compact).toContain("pivot: briefly land the previous thread")
    expect(compact).toContain("let me shift")
    expect(compact).toContain("do not stack separate evidence asks")
    expect(compact).toContain("Separately compare current.answer with current.question")
    expect(compact).toContain("do not manufacture continuity")
    expect(compact).toContain("Leave nextSignalKey empty")
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

  it("persists and exposes exhausted goals as insufficient evidence", () => {
    const goal = applicationSignalDefinitions(["Contribution"])[0]
    const keys = collectApplicationInsufficientEvidenceKeys([
      {
        role: "user",
        content: "I don't know.",
        metadata: {
          application_insufficient_evidence: {
            key: goal.key,
            label: goal.label,
            attempts: 3,
          },
        },
      },
    ])
    expect(keys.has(goal.key)).toBe(true)
    expect(
      buildCompactApplicationStateMessage({
        definitions: [goal],
        answers: [
          {
            ...goal,
            answer: "Not sure.\nFollow-up: I don't know.\nFollow-up: Still unsure.",
            covered: false,
          },
        ],
        currentSignal: goal,
        currentQuestion: "What would you contribute?",
        currentAnswer: "Still unsure.",
        insufficientEvidenceKeys: keys,
      }),
    ).toContain('"status":"insufficient_evidence"')
  })
})
