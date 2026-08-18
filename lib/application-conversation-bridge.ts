export const APPLICATION_BRIDGE_KINDS = [
  "person_to_work",
  "work_to_detail",
  "judgment_to_reason",
  "personal_connection_to_origin",
  "maker_to_practice",
  "action_to_consequence",
  "sharing_to_selection",
  "feedback_to_care",
  "aspiration_to_contribution",
  "tension_to_judgment",
  "callback",
] as const

export type ApplicationBridgeKind = (typeof APPLICATION_BRIDGE_KINDS)[number]
export type ApplicationBridgeFreshness = "current" | "recent" | "earlier"

export type ApplicationBridgeCandidate = {
  sourceDetail: string
  kind: ApplicationBridgeKind
  targetSignalKey: string | null
  questionIntent: string
  confidence: number
  freshness: ApplicationBridgeFreshness
}

export type ApplicationBridgePlan = {
  candidates: ApplicationBridgeCandidate[]
  selectedIndex: number
  selected: ApplicationBridgeCandidate | null
}

export type ApplicationBridgeHistory = {
  recentKinds: ApplicationBridgeKind[]
  lastKind: ApplicationBridgeKind | null
  repeatedKindCount: number
}

export type ApplicationBridgeMessage = {
  role: "user" | "assistant"
  metadata?: unknown
}

const KIND_SET = new Set<string>(APPLICATION_BRIDGE_KINDS)
const FRESHNESS_SET = new Set<string>(["current", "recent", "earlier"])
const SIGNAL_KEY_PATTERN = /^[a-z0-9_]{1,64}$/
const MAX_BRIDGE_CANDIDATES = 3
export const MIN_APPLICATION_BRIDGE_CONFIDENCE = 0.55
const MIN_PRIORITY_MAKER_BRIDGE_CONFIDENCE = 0.7

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function conciseText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim().replace(/\s+/g, " ").slice(0, maximum)
  return text || null
}

function normaliseSignalKey(value: unknown): string | null {
  if (typeof value !== "string") return null
  const key = value.trim()
  return SIGNAL_KEY_PATTERN.test(key) ? key : null
}

function normaliseConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(1, value))
}

export function normaliseApplicationBridgeCandidate(
  raw: unknown,
): ApplicationBridgeCandidate | null {
  const value = record(raw)
  if (!value) return null
  const sourceDetail = conciseText(value.sourceDetail, 180)
  const questionIntent = conciseText(value.questionIntent, 220)
  const confidence = normaliseConfidence(value.confidence)
  if (
    !sourceDetail ||
    !questionIntent ||
    confidence === null ||
    typeof value.kind !== "string" ||
    !KIND_SET.has(value.kind) ||
    typeof value.freshness !== "string" ||
    !FRESHNESS_SET.has(value.freshness)
  ) {
    return null
  }
  return {
    sourceDetail,
    questionIntent,
    confidence,
    kind: value.kind as ApplicationBridgeKind,
    freshness: value.freshness as ApplicationBridgeFreshness,
    targetSignalKey: normaliseSignalKey(value.targetSignalKey),
  }
}

export function normaliseApplicationBridgePlan(input: {
  candidates: unknown
  selectedIndex: unknown
}): ApplicationBridgePlan {
  const rawCandidates = Array.isArray(input.candidates)
    ? input.candidates.slice(0, MAX_BRIDGE_CANDIDATES)
    : []
  const requestedIndex =
    typeof input.selectedIndex === "number" &&
    Number.isInteger(input.selectedIndex) &&
    input.selectedIndex >= 0 &&
    input.selectedIndex < rawCandidates.length
      ? input.selectedIndex
      : -1
  const normalisedCandidates = rawCandidates.flatMap((candidate, index) => {
    const normalised = normaliseApplicationBridgeCandidate(candidate)
    return normalised ? [{ candidate: normalised, originalIndex: index }] : []
  })
  const candidates = normalisedCandidates.map(({ candidate }) => candidate)
  const selectedIndex = normalisedCandidates.findIndex(
    ({ originalIndex }) => originalIndex === requestedIndex,
  )
  return {
    candidates,
    selectedIndex,
    selected: selectedIndex >= 0 ? candidates[selectedIndex] : null,
  }
}

export function collectApplicationBridgeHistory(
  messages: ApplicationBridgeMessage[],
): ApplicationBridgeHistory {
  const kinds = messages.flatMap((message) => {
    if (message.role !== "assistant") return []
    const bridge = record(record(message.metadata)?.conversation_bridge)
    const kind = bridge?.kind
    return typeof kind === "string" && KIND_SET.has(kind)
      ? [kind as ApplicationBridgeKind]
      : []
  })
  const lastKind = kinds.at(-1) ?? null
  let repeatedKindCount = 0
  if (lastKind) {
    for (let index = kinds.length - 1; index >= 0; index -= 1) {
      if (kinds[index] !== lastKind) break
      repeatedKindCount += 1
    }
  }
  return {
    recentKinds: kinds.slice(-4),
    lastKind,
    repeatedKindCount,
  }
}

export function validateApplicationBridgeSelection(input: {
  plan: ApplicationBridgePlan
  history: ApplicationBridgeHistory
  eligibleSignalKeys: Set<string>
  allowCurrentSignalKey?: string | null
  remainingQuestions: number
  isTerminal: boolean
  signalPriorities?: Map<string, "core" | "supporting">
}): ApplicationBridgeCandidate | null {
  if (input.isTerminal || input.remainingQuestions <= 0) return null
  const isValid = (candidate: ApplicationBridgeCandidate): boolean => {
    if (candidate.confidence < MIN_APPLICATION_BRIDGE_CONFIDENCE) return false
    if (
      !candidate.targetSignalKey ||
      (!input.eligibleSignalKeys.has(candidate.targetSignalKey) &&
        candidate.targetSignalKey !== input.allowCurrentSignalKey)
    ) {
      return false
    }
    return !(
      input.history.lastKind === candidate.kind &&
      input.history.repeatedKindCount >= 2
    )
  }
  const selected = input.plan.selected
  const priorityMakerBridge = input.plan.candidates.find(
    (candidate) =>
      candidate.kind === "maker_to_practice" &&
      candidate.freshness === "current" &&
      candidate.confidence >= MIN_PRIORITY_MAKER_BRIDGE_CONFIDENCE &&
      candidate.targetSignalKey !== null &&
      input.signalPriorities?.get(candidate.targetSignalKey) === "core" &&
      isValid(candidate),
  )
  const selectedTargetsSupportingGoal =
    selected?.targetSignalKey !== null &&
    selected?.targetSignalKey !== undefined &&
    input.signalPriorities?.get(selected.targetSignalKey) === "supporting"
  if (
    priorityMakerBridge &&
    (!selected || selectedTargetsSupportingGoal)
  ) {
    return priorityMakerBridge
  }
  return selected && isValid(selected) ? selected : null
}
