import { describe, expect, it } from "vitest"
import {
  collectApplicationConversationDepth,
  normaliseApplicationAnswerAssessment,
  validateApplicationConversationMove,
  type ApplicationAnswerAssessment,
} from "@/lib/application-conversation-depth"

const thinAssessment: ApplicationAnswerAssessment = {
  quality: "thin",
  reason: "Names a subject but gives no point of view yet.",
  evidence: {
    personalPointOfView: false,
    concreteDetail: false,
    emotionalConnection: false,
    independentJudgment: false,
    careOrContext: false,
  },
}

const richAssessment: ApplicationAnswerAssessment = {
  quality: "rich",
  reason: "Offers a concise and particular judgment.",
  evidence: {
    personalPointOfView: true,
    concreteDetail: true,
    emotionalConnection: false,
    independentJudgment: true,
    careOrContext: true,
  },
}

describe("application conversation depth", () => {
  it("normalises semantic evidence without using answer length", () => {
    expect(
      normaliseApplicationAnswerAssessment({
        ...richAssessment,
        reason: "Loraine James—the tension between precision and chaos.",
      }),
    ).toEqual({
      ...richAssessment,
      reason: "Loraine James—the tension between precision and chaos.",
    })
  })

  it("collects persisted quality and conversation-point trajectory", () => {
    const depth = collectApplicationConversationDepth([
      {
        role: "user",
        metadata: { answer_assessment: thinAssessment },
      },
      {
        role: "assistant",
        metadata: { conversation_move: "open_door" },
      },
      {
        role: "user",
        metadata: { answer_assessment: richAssessment },
      },
      {
        role: "assistant",
        metadata: { conversation_move: "rabbit_hole" },
      },
    ])

    expect(depth.recentQualities).toEqual(["thin", "rich"])
    expect(depth.openDoorUsed).toBe(true)
    expect(depth.rabbitHoleUsed).toBe(true)
    expect(depth.conversationPointsRemaining).toBe(4)
    expect(depth.adaptiveTurnsUsed).toBe(2)
  })

  it("allows one open door only after repeated thin evidence", () => {
    const depth = collectApplicationConversationDepth([
      {
        role: "user",
        metadata: { answer_assessment: thinAssessment },
      },
    ])
    expect(
      validateApplicationConversationMove({
        proposedMove: "open_door",
        assessment: thinAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 2,
        remainingQuestions: 5,
      }),
    ).toMatchObject({ move: "open_door", accepted: true })
  })

  it("falls back to clarification when an open door is premature", () => {
    const depth = collectApplicationConversationDepth([])
    expect(
      validateApplicationConversationMove({
        proposedMove: "open_door",
        assessment: thinAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 2,
        remainingQuestions: 5,
      }),
    ).toMatchObject({ move: "clarify", accepted: false })
  })

  it("allows a rabbit hole for rich evidence while points remain", () => {
    const depth = collectApplicationConversationDepth([])
    expect(
      validateApplicationConversationMove({
        proposedMove: "rabbit_hole",
        assessment: richAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 1,
        remainingQuestions: 3,
      }),
    ).toMatchObject({ move: "rabbit_hole", accepted: true })
  })

  it("allows a second connected depth turn when recovery could affect a core goal", () => {
    const depth = collectApplicationConversationDepth([
      { role: "assistant", metadata: { conversation_move: "rabbit_hole" } },
    ])
    expect(
      validateApplicationConversationMove({
        proposedMove: "rabbit_hole",
        assessment: richAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 1,
        remainingQuestions: 3,
        allowSecondClarification: true,
      }),
    ).toMatchObject({ move: "rabbit_hole", accepted: true })
  })

  it("defaults to one clarification per goal", () => {
    const depth = collectApplicationConversationDepth([
      { role: "assistant", metadata: { conversation_move: "clarify" } },
    ])
    expect(
      validateApplicationConversationMove({
        proposedMove: "clarify",
        assessment: thinAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 1,
        remainingQuestions: 5,
      }),
    ).toMatchObject({ move: "advance", accepted: false })
  })

  it("advances instead of clarifying evidence that is already usable or rich", () => {
    const depth = collectApplicationConversationDepth([])
    expect(
      validateApplicationConversationMove({
        proposedMove: "clarify",
        assessment: richAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 2,
        remainingQuestions: 5,
      }),
    ).toMatchObject({ move: "advance", accepted: false })
  })

  it("does not stop a relevant clarification because three earlier adaptive turns were used", () => {
    const depth = collectApplicationConversationDepth([
      { role: "assistant", metadata: { conversation_move: "clarify" } },
      { role: "assistant", metadata: { conversation_move: "open_door" } },
      { role: "assistant", metadata: { conversation_move: "rabbit_hole" } },
    ])
    expect(
      validateApplicationConversationMove({
        proposedMove: "clarify",
        assessment: thinAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 2,
        remainingQuestions: 4,
      }),
    ).toMatchObject({ move: "clarify", accepted: true })
  })

  it("counts repeated thin evidence across distinct goals", () => {
    const depth = collectApplicationConversationDepth([
      {
        role: "user",
        metadata: {
          answer_assessment: thinAssessment,
          application_signal: { key: "artist" },
        },
      },
      {
        role: "user",
        metadata: {
          answer_assessment: thinAssessment,
          application_signal: { key: "artist" },
        },
      },
      {
        role: "user",
        metadata: {
          answer_assessment: thinAssessment,
          application_signal: { key: "participation" },
        },
      },
    ])
    expect(depth.thinSignalCount).toBe(2)
  })

  it("advances when no follow-up budget remains", () => {
    const depth = collectApplicationConversationDepth([])
    expect(
      validateApplicationConversationMove({
        proposedMove: "rabbit_hole",
        assessment: richAssessment,
        depth,
        hasCurrentSignal: true,
        followupsRemaining: 0,
        remainingQuestions: 3,
      }),
    ).toMatchObject({ move: "advance", accepted: false })
  })
})
