import type { ApplicationConversationMove } from "@/lib/application-conversation-depth"

export const APPLICATION_RESPONSE_MODES = [
  "reflect",
  "interpret",
  "probe",
  "deepen",
  "connect",
  "challenge",
  "pivot",
  "close",
] as const

export type ApplicationResponseMode =
  (typeof APPLICATION_RESPONSE_MODES)[number]

export type ResponseModeMessage = {
  role: "user" | "assistant"
  metadata?: unknown
}

export type ApplicationResponseModeHistory = {
  recentModes: ApplicationResponseMode[]
  lastMode: ApplicationResponseMode | null
  repeatedModeCount: number
}

const MODE_SET = new Set<string>(APPLICATION_RESPONSE_MODES)

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function normaliseApplicationResponseMode(
  raw: unknown,
): ApplicationResponseMode | null {
  return typeof raw === "string" && MODE_SET.has(raw)
    ? (raw as ApplicationResponseMode)
    : null
}

export function collectApplicationResponseModeHistory(
  messages: ResponseModeMessage[],
): ApplicationResponseModeHistory {
  const modes = messages.flatMap((message) => {
    if (message.role !== "assistant") return []
    const mode = normaliseApplicationResponseMode(
      record(message.metadata)?.response_mode,
    )
    return mode ? [mode] : []
  })
  const lastMode = modes.at(-1) ?? null
  let repeatedModeCount = 0
  if (lastMode) {
    for (let index = modes.length - 1; index >= 0; index -= 1) {
      if (modes[index] !== lastMode) break
      repeatedModeCount += 1
    }
  }
  return {
    recentModes: modes.slice(-4),
    lastMode,
    repeatedModeCount,
  }
}

const ALLOWED_BY_MOVE: Record<
  ApplicationConversationMove,
  readonly ApplicationResponseMode[]
> = {
  clarify: ["probe", "reflect", "interpret"],
  open_door: ["pivot", "reflect", "connect", "probe"],
  advance: ["connect", "pivot", "probe", "interpret", "reflect"],
  rabbit_hole: ["deepen", "interpret", "connect", "probe"],
  challenge: ["challenge"],
  decide: ["close"],
}

const DEFAULT_BY_MOVE: Record<
  ApplicationConversationMove,
  ApplicationResponseMode
> = {
  clarify: "probe",
  open_door: "pivot",
  advance: "connect",
  rabbit_hole: "deepen",
  challenge: "challenge",
  decide: "close",
}

export function resolveApplicationResponseMode(input: {
  proposed: ApplicationResponseMode | null
  move: ApplicationConversationMove
  isTerminal: boolean
}): ApplicationResponseMode {
  if (input.isTerminal) return "close"
  const allowed = ALLOWED_BY_MOVE[input.move]
  return input.proposed && allowed.includes(input.proposed)
    ? input.proposed
    : DEFAULT_BY_MOVE[input.move]
}
