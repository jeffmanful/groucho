export type GrouchoIntent =
  | "probe"
  | "clarify"
  | "challenge"
  | "acknowledge"
  | "decide"
  | "redirect"
  | "reject"

export type GrouchoInputType =
  | "text"
  | "voice"
  | "singleSelect"
  | "multiSelect"
  | "ranking"

export type GrouchoEmotionalState =
  | "neutral"
  | "curious"
  | "interested"
  | "skeptical"
  | "evaluating"
  | "decisive"

export type GrouchoVisualState =
  | "idle"
  | "listening"
  | "thinking"
  | "curious"
  | "interested"
  | "evaluating"
  | "decision"

export type GatekeeperTerminalField = "none" | "pass" | "redirect" | "reject"

export type GrouchoInteractionSpec = {
  intent: GrouchoIntent
  inputType: GrouchoInputType
  emotionalState: GrouchoEmotionalState
  visualState: GrouchoVisualState
  options?: string[]
}

export type GrouchoInteractionUi = GrouchoInteractionSpec

const INTENTS = new Set<GrouchoIntent>([
  "probe",
  "clarify",
  "challenge",
  "acknowledge",
  "decide",
  "redirect",
  "reject",
])

const INPUT_TYPES = new Set<GrouchoInputType>([
  "text",
  "voice",
  "singleSelect",
  "multiSelect",
  "ranking",
])

const EMOTIONAL_STATES = new Set<GrouchoEmotionalState>([
  "neutral",
  "curious",
  "interested",
  "skeptical",
  "evaluating",
  "decisive",
])

const VISUAL_STATES = new Set<GrouchoVisualState>([
  "idle",
  "listening",
  "thinking",
  "curious",
  "interested",
  "evaluating",
  "decision",
])

const STRUCTURED_INPUT_TYPES = new Set<GrouchoInputType>([
  "singleSelect",
  "multiSelect",
  "ranking",
])

export const DEFAULT_INTERACTION_SPEC: GrouchoInteractionSpec = {
  intent: "probe",
  inputType: "text",
  emotionalState: "neutral",
  visualState: "thinking",
}

function normaliseOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const options = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
  return options.length > 0 ? options : undefined
}

function intentForTerminal(terminal: GatekeeperTerminalField): GrouchoIntent {
  if (terminal === "pass") return "decide"
  if (terminal === "redirect") return "redirect"
  if (terminal === "reject") return "reject"
  return DEFAULT_INTERACTION_SPEC.intent
}

function visualStateForTerminal(terminal: GatekeeperTerminalField): GrouchoVisualState {
  if (terminal === "none") return DEFAULT_INTERACTION_SPEC.visualState
  return "decision"
}

function emotionalStateForTerminal(
  terminal: GatekeeperTerminalField,
): GrouchoEmotionalState {
  if (terminal === "none") return DEFAULT_INTERACTION_SPEC.emotionalState
  return "decisive"
}

export function normaliseInteractionSpec(
  raw: Record<string, unknown>,
  terminal: GatekeeperTerminalField,
): GrouchoInteractionSpec {
  const intent =
    typeof raw.intent === "string" && INTENTS.has(raw.intent as GrouchoIntent)
      ? (raw.intent as GrouchoIntent)
      : intentForTerminal(terminal)

  let inputType =
    typeof raw.inputType === "string" &&
    INPUT_TYPES.has(raw.inputType as GrouchoInputType)
      ? (raw.inputType as GrouchoInputType)
      : DEFAULT_INTERACTION_SPEC.inputType

  const emotionalState =
    typeof raw.emotionalState === "string" &&
    EMOTIONAL_STATES.has(raw.emotionalState as GrouchoEmotionalState)
      ? (raw.emotionalState as GrouchoEmotionalState)
      : emotionalStateForTerminal(terminal)

  const visualState =
    typeof raw.visualState === "string" &&
    VISUAL_STATES.has(raw.visualState as GrouchoVisualState)
      ? (raw.visualState as GrouchoVisualState)
      : visualStateForTerminal(terminal)

  let options = normaliseOptions(raw.options)
  if (STRUCTURED_INPUT_TYPES.has(inputType) && !options) {
    inputType = "text"
    options = undefined
  }

  if (terminal !== "none") {
    return {
      intent: intentForTerminal(terminal),
      inputType: "text",
      emotionalState: emotionalStateForTerminal(terminal),
      visualState: visualStateForTerminal(terminal),
    }
  }

  return {
    intent,
    inputType,
    emotionalState,
    visualState,
    ...(options ? { options } : {}),
  }
}

/** Derive application UI posture from the validated conversational move. */
export function interactionSpecForApplicationMove(
  move: string | null,
  terminal: GatekeeperTerminalField,
): GrouchoInteractionSpec {
  if (terminal !== "none") return normaliseInteractionSpec({}, terminal)
  if (move === "challenge") {
    return {
      intent: "challenge",
      inputType: "text",
      emotionalState: "skeptical",
      visualState: "evaluating",
    }
  }
  if (move === "clarify" || move === "open_door") {
    return {
      intent: "clarify",
      inputType: "text",
      emotionalState: "curious",
      visualState: "curious",
    }
  }
  if (move === "rabbit_hole") {
    return {
      intent: "probe",
      inputType: "text",
      emotionalState: "interested",
      visualState: "interested",
    }
  }
  return { ...DEFAULT_INTERACTION_SPEC }
}
