export const ANSWER_QUALITIES = [
  "thin",
  "usable",
  "rich",
  "concerning",
] as const

export type ApplicationAnswerQuality = (typeof ANSWER_QUALITIES)[number]

export const CONVERSATION_MOVES = [
  "clarify",
  "open_door",
  "advance",
  "rabbit_hole",
  "challenge",
  "decide",
] as const

export type ApplicationConversationMove = (typeof CONVERSATION_MOVES)[number]

export type ApplicationAnswerEvidence = {
  personalPointOfView: boolean
  concreteDetail: boolean
  emotionalConnection: boolean
  independentJudgment: boolean
  careOrContext: boolean
}

export type ApplicationAnswerAssessment = {
  quality: ApplicationAnswerQuality
  reason: string
  evidence: ApplicationAnswerEvidence
}

export type ConversationDepthMessage = {
  role: "user" | "assistant"
  metadata?: unknown
}

export type ApplicationConversationDepth = {
  recentQualities: ApplicationAnswerQuality[]
  thinAnswerCount: number
  richAnswerCount: number
  openDoorUsed: boolean
  rabbitHoleUsed: boolean
  conversationPointsUsed: number
  conversationPointsRemaining: number
  adaptiveTurnsUsed: number
  adaptiveTurnsRemaining: number
  thinSignalCount: number
}

export type ConversationMoveValidation = {
  move: ApplicationConversationMove
  accepted: boolean
  reason: string
}

export const DEFAULT_MAX_CONVERSATION_POINTS = 2
export const DEFAULT_MAX_ADAPTIVE_TURNS = 3

const QUALITY_SET = new Set<string>(ANSWER_QUALITIES)
const MOVE_SET = new Set<string>(CONVERSATION_MOVES)

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function booleanEvidence(
  value: Record<string, unknown>,
  key: keyof ApplicationAnswerEvidence,
): boolean {
  return value[key] === true
}

export function normaliseApplicationAnswerAssessment(
  raw: unknown,
): ApplicationAnswerAssessment | null {
  const value = record(raw)
  if (!value || typeof value.quality !== "string") return null
  if (!QUALITY_SET.has(value.quality)) return null

  const evidence = record(value.evidence)
  if (!evidence) return null

  return {
    quality: value.quality as ApplicationAnswerQuality,
    reason:
      typeof value.reason === "string" ? value.reason.trim().slice(0, 280) : "",
    evidence: {
      personalPointOfView: booleanEvidence(evidence, "personalPointOfView"),
      concreteDetail: booleanEvidence(evidence, "concreteDetail"),
      emotionalConnection: booleanEvidence(evidence, "emotionalConnection"),
      independentJudgment: booleanEvidence(evidence, "independentJudgment"),
      careOrContext: booleanEvidence(evidence, "careOrContext"),
    },
  }
}

export function normaliseApplicationConversationMove(
  raw: unknown,
): ApplicationConversationMove | null {
  if (typeof raw !== "string" || !MOVE_SET.has(raw)) return null
  return raw as ApplicationConversationMove
}

function assessmentFromMetadata(
  metadata: unknown,
): ApplicationAnswerAssessment | null {
  return normaliseApplicationAnswerAssessment(record(metadata)?.answer_assessment)
}

function moveFromMetadata(
  metadata: unknown,
): ApplicationConversationMove | null {
  return normaliseApplicationConversationMove(record(metadata)?.conversation_move)
}

function signalKeyFromMetadata(metadata: unknown): string | null {
  const signal = record(record(metadata)?.application_signal)
  return typeof signal?.key === "string" ? signal.key : null
}

export function collectApplicationConversationDepth(
  messages: ConversationDepthMessage[],
  maxConversationPoints = DEFAULT_MAX_CONVERSATION_POINTS,
): ApplicationConversationDepth {
  const qualities = messages.flatMap((message) => {
    if (message.role !== "user") return []
    const assessment = assessmentFromMetadata(message.metadata)
    return assessment ? [assessment.quality] : []
  })
  const moves = messages.flatMap((message) => {
    if (message.role !== "assistant") return []
    const move = moveFromMetadata(message.metadata)
    return move ? [move] : []
  })
  const openDoorUsed = moves.includes("open_door")
  const rabbitHoleUsed = moves.includes("rabbit_hole")
  const conversationPointsUsed = moves.filter(
    (move) => move === "open_door" || move === "rabbit_hole",
  ).length
  const adaptiveTurnsUsed = moves.filter((move) =>
    ["clarify", "open_door", "rabbit_hole"].includes(move),
  ).length
  const thinSignalCount = new Set(
    messages.flatMap((message) => {
      if (message.role !== "user") return []
      const assessment = assessmentFromMetadata(message.metadata)
      const key = signalKeyFromMetadata(message.metadata)
      return assessment?.quality === "thin" && key ? [key] : []
    }),
  ).size

  return {
    recentQualities: qualities.slice(-3),
    thinAnswerCount: qualities.filter((quality) => quality === "thin").length,
    richAnswerCount: qualities.filter((quality) => quality === "rich").length,
    openDoorUsed,
    rabbitHoleUsed,
    conversationPointsUsed,
    conversationPointsRemaining: Math.max(
      0,
      maxConversationPoints - conversationPointsUsed,
    ),
    adaptiveTurnsUsed,
    adaptiveTurnsRemaining: Math.max(
      0,
      DEFAULT_MAX_ADAPTIVE_TURNS - adaptiveTurnsUsed,
    ),
    thinSignalCount,
  }
}

export function validateApplicationConversationMove(input: {
  proposedMove: ApplicationConversationMove
  assessment: ApplicationAnswerAssessment | null
  depth: ApplicationConversationDepth
  hasCurrentSignal: boolean
  followupsRemaining: number
  remainingQuestions: number
  allowAdaptiveTurns?: boolean
  allowSecondClarification?: boolean
}): ConversationMoveValidation {
  const canAskOnSignal =
    input.hasCurrentSignal &&
    input.followupsRemaining > 0 &&
    input.remainingQuestions > 0
  const canUseAdaptiveTurn =
    canAskOnSignal &&
    input.allowAdaptiveTurns !== false &&
    input.depth.adaptiveTurnsRemaining > 0
  const previousQuality = input.depth.recentQualities.at(-1) ?? null

  const fallback = (): ConversationMoveValidation => ({
    move:
      input.assessment?.quality === "thin" &&
        canUseAdaptiveTurn &&
        (input.followupsRemaining > 1 || input.allowSecondClarification === true)
        ? "clarify"
        : "advance",
    accepted: false,
    reason: "Proposed move was outside the available quality or turn budget.",
  })

  if (input.proposedMove === "advance") {
    return { move: "advance", accepted: true, reason: "Advance is available." }
  }

  if (input.proposedMove === "decide") {
    return {
      move: "advance",
      accepted: false,
      reason: "A non-terminal turn cannot use decide.",
    }
  }

  if (!canAskOnSignal) return fallback()

  if (input.proposedMove === "clarify") {
    if (
      input.assessment?.quality !== "thin" ||
      !canUseAdaptiveTurn ||
      (input.followupsRemaining === 1 && input.allowSecondClarification !== true)
    ) {
      return fallback()
    }
    return {
      move: "clarify",
      accepted: true,
      reason: "Clarification budget remains.",
    }
  }

  if (input.proposedMove === "open_door") {
    if (
      !canUseAdaptiveTurn ||
      input.assessment?.quality !== "thin" ||
      previousQuality !== "thin" ||
      input.depth.openDoorUsed ||
      input.depth.conversationPointsRemaining <= 0
    ) {
      return fallback()
    }
    return {
      move: "open_door",
      accepted: true,
      reason: "Repeated thin evidence qualifies for the open-door move.",
    }
  }

  if (input.proposedMove === "rabbit_hole") {
    if (
      !canUseAdaptiveTurn ||
      input.assessment?.quality !== "rich" ||
      input.depth.conversationPointsRemaining <= 0
    ) {
      return fallback()
    }
    return {
      move: "rabbit_hole",
      accepted: true,
      reason: "Rich evidence qualifies for a depth question while conversation points remain.",
    }
  }

  if (input.proposedMove === "challenge") {
    if (input.assessment?.quality !== "concerning") return fallback()
    return {
      move: "challenge",
      accepted: true,
      reason: "Concerning evidence qualifies for a bounded challenge.",
    }
  }

  return fallback()
}
