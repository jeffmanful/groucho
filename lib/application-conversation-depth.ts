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
  thinSignalCount: number
}

export type ConversationMoveValidation = {
  move: ApplicationConversationMove
  accepted: boolean
  reason: string
}

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
  const evidenceFlags = new Set(
    Array.isArray(value.evidenceFlags)
      ? value.evidenceFlags.filter((flag): flag is string => typeof flag === "string")
      : [],
  )
  if (!evidence && evidenceFlags.size === 0 && value.quality !== "thin") {
    return null
  }

  return {
    quality: value.quality as ApplicationAnswerQuality,
    reason:
      typeof value.reason === "string" ? value.reason.trim().slice(0, 280) : "",
    evidence: {
      personalPointOfView:
        evidenceFlags.has("point_of_view") ||
        (evidence ? booleanEvidence(evidence, "personalPointOfView") : false),
      concreteDetail:
        evidenceFlags.has("detail") ||
        (evidence ? booleanEvidence(evidence, "concreteDetail") : false),
      emotionalConnection:
        evidenceFlags.has("emotion") ||
        (evidence ? booleanEvidence(evidence, "emotionalConnection") : false),
      independentJudgment:
        evidenceFlags.has("judgment") ||
        (evidence ? booleanEvidence(evidence, "independentJudgment") : false),
      careOrContext:
        evidenceFlags.has("care") ||
        (evidence ? booleanEvidence(evidence, "careOrContext") : false),
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
  allowSecondClarification?: boolean
}): ConversationMoveValidation {
  const canAskOnSignal =
    input.hasCurrentSignal &&
    input.followupsRemaining > 0 &&
    input.remainingQuestions > 0
  const previousQuality = input.depth.recentQualities.at(-1) ?? null

  const fallback = (): ConversationMoveValidation => ({
    move:
      input.assessment?.quality === "thin" &&
        canAskOnSignal &&
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
      input.assessment?.quality !== "thin" ||
      previousQuality !== "thin" ||
      input.depth.openDoorUsed
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
    if (input.assessment?.quality !== "rich") {
      return fallback()
    }
    return {
      move: "rabbit_hole",
      accepted: true,
      reason: "Rich evidence qualifies for a depth question while the current intent can still be explored.",
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
