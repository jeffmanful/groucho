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
  | "mediaChoice"

export type MediaChoiceMode = "select" | "remove" | "rank"

export type MediaChoiceOption = {
  id: string
  label: string
  description?: string
  media: {
    type: "video"
    provider: "youtube"
    videoId: string
    title: string
    artist?: string
    thumbnailUrl?: string
    durationSeconds?: number
    startSeconds?: number
    captionsUrl?: string
    transcript?: string
    alt: string
  }
}

export type MediaChoiceInteraction = {
  id: string
  options: MediaChoiceOption[]
  selection: {
    mode: MediaChoiceMode
    minSelections: number
    maxSelections: number
  }
  rationale: {
    required: boolean
    prompt: string
    minLength?: number
    maxLength: number
  }
}

export type MediaChoiceAnswer = {
  type: "mediaChoice"
  questionId: string
  mode: MediaChoiceMode
  optionIds: string[]
  rationale?: string
}

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
  mediaChoice?: MediaChoiceInteraction
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
  "mediaChoice",
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

const MEDIA_CHOICE_MODES = new Set<MediaChoiceMode>([
  "select",
  "remove",
  "rank",
])

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/
const MAX_MEDIA_OPTIONS = 8
const MAX_RATIONALE_LENGTH = 2000

function trimmedString(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== "string") return undefined
  const value = raw.trim()
  return value ? value.slice(0, maxLength) : undefined
}

function safeResourceUrl(raw: unknown): string | undefined {
  const value = trimmedString(raw, 2048)
  if (!value) return undefined
  if (value.startsWith("/")) return value
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function boundedInteger(
  raw: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined
  return Math.min(maximum, Math.max(minimum, Math.floor(raw)))
}

function normaliseMediaChoiceOption(raw: unknown): MediaChoiceOption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const option = raw as Record<string, unknown>
  const id = trimmedString(option.id, 64)
  const label = trimmedString(option.label, 120)
  const mediaRaw = option.media
  if (
    !id ||
    !SAFE_ID_RE.test(id) ||
    !label ||
    !mediaRaw ||
    typeof mediaRaw !== "object" ||
    Array.isArray(mediaRaw)
  ) {
    return null
  }
  const media = mediaRaw as Record<string, unknown>
  const videoId = trimmedString(media.videoId, 24)
  const title = trimmedString(media.title, 160)
  const alt = trimmedString(media.alt, 240)
  if (
    media.type !== "video" ||
    media.provider !== "youtube" ||
    !videoId ||
    !YOUTUBE_VIDEO_ID_RE.test(videoId) ||
    !title ||
    !alt
  ) {
    return null
  }

  const description = trimmedString(option.description, 240)
  const artist = trimmedString(media.artist, 120)
  const thumbnailUrl = safeResourceUrl(media.thumbnailUrl)
  const captionsUrl = safeResourceUrl(media.captionsUrl)
  const transcript = trimmedString(media.transcript, 4000)
  const durationSeconds = boundedInteger(media.durationSeconds, 1, 86_400)
  const startSeconds = boundedInteger(media.startSeconds, 0, 86_400)

  return {
    id,
    label,
    ...(description ? { description } : {}),
    media: {
      type: "video",
      provider: "youtube",
      videoId,
      title,
      ...(artist ? { artist } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      ...(startSeconds !== undefined ? { startSeconds } : {}),
      ...(captionsUrl ? { captionsUrl } : {}),
      ...(transcript ? { transcript } : {}),
      alt,
    },
  }
}

export function normaliseMediaChoiceInteraction(
  raw: unknown,
): MediaChoiceInteraction | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const id = trimmedString(value.id, 64)
  if (!id || !SAFE_ID_RE.test(id) || !Array.isArray(value.options)) {
    return undefined
  }

  const options: MediaChoiceOption[] = []
  const optionIds = new Set<string>()
  for (const rawOption of value.options.slice(0, MAX_MEDIA_OPTIONS)) {
    const option = normaliseMediaChoiceOption(rawOption)
    if (!option || optionIds.has(option.id)) continue
    optionIds.add(option.id)
    options.push(option)
  }
  if (options.length < 2) return undefined

  const selectionRaw = value.selection
  if (
    !selectionRaw ||
    typeof selectionRaw !== "object" ||
    Array.isArray(selectionRaw)
  ) {
    return undefined
  }
  const selection = selectionRaw as Record<string, unknown>
  const mode = MEDIA_CHOICE_MODES.has(selection.mode as MediaChoiceMode)
    ? (selection.mode as MediaChoiceMode)
    : null
  if (!mode) return undefined
  const minSelections = boundedInteger(selection.minSelections, 1, options.length)
  const maxSelections = boundedInteger(selection.maxSelections, 1, options.length)
  if (
    minSelections === undefined ||
    maxSelections === undefined ||
    minSelections > maxSelections
  ) {
    return undefined
  }

  const rationaleRaw = value.rationale
  const rationale =
    rationaleRaw &&
    typeof rationaleRaw === "object" &&
    !Array.isArray(rationaleRaw)
      ? (rationaleRaw as Record<string, unknown>)
      : {}
  const required = rationale.required === true
  const prompt =
    trimmedString(rationale.prompt, 160) ??
    (required ? "Tell us why…" : "Add a note (optional)")
  const minLength = boundedInteger(rationale.minLength, 0, MAX_RATIONALE_LENGTH)
  const maxLength =
    boundedInteger(rationale.maxLength, 1, MAX_RATIONALE_LENGTH) ??
    MAX_RATIONALE_LENGTH
  if (minLength !== undefined && minLength > maxLength) return undefined

  return {
    id,
    options,
    selection: { mode, minSelections, maxSelections },
    rationale: {
      required,
      prompt,
      ...(minLength !== undefined ? { minLength } : {}),
      maxLength,
    },
  }
}

export function normaliseMediaChoiceAnswer(
  raw: unknown,
): MediaChoiceAnswer | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const questionId = trimmedString(value.questionId, 64)
  const mode = MEDIA_CHOICE_MODES.has(value.mode as MediaChoiceMode)
    ? (value.mode as MediaChoiceMode)
    : null
  if (
    value.type !== "mediaChoice" ||
    !questionId ||
    !SAFE_ID_RE.test(questionId) ||
    !mode ||
    !Array.isArray(value.optionIds)
  ) {
    return undefined
  }
  const optionIds = [
    ...new Set(
      value.optionIds.filter(
        (optionId): optionId is string =>
          typeof optionId === "string" && SAFE_ID_RE.test(optionId),
      ),
    ),
  ].slice(0, MAX_MEDIA_OPTIONS)
  if (!optionIds.length) return undefined
  const rationale = trimmedString(value.rationale, MAX_RATIONALE_LENGTH)
  return {
    type: "mediaChoice",
    questionId,
    mode,
    optionIds,
    ...(rationale ? { rationale } : {}),
  }
}

export type MediaChoiceAnswerValidation =
  | { ok: true; answer: MediaChoiceAnswer; message: string }
  | { ok: false; error: string }

export function validateMediaChoiceAnswer(
  rawAnswer: unknown,
  interaction: MediaChoiceInteraction,
): MediaChoiceAnswerValidation {
  const answer = normaliseMediaChoiceAnswer(rawAnswer)
  if (!answer) return { ok: false, error: "Invalid media choice answer" }
  if (answer.questionId !== interaction.id || answer.mode !== interaction.selection.mode) {
    return { ok: false, error: "Media choice answer does not match the active question" }
  }
  if (
    answer.optionIds.length < interaction.selection.minSelections ||
    answer.optionIds.length > interaction.selection.maxSelections
  ) {
    return {
      ok: false,
      error: `Choose between ${interaction.selection.minSelections} and ${interaction.selection.maxSelections} options`,
    }
  }
  const optionsById = new Map(interaction.options.map((option) => [option.id, option]))
  if (answer.optionIds.some((id) => !optionsById.has(id))) {
    return { ok: false, error: "Media choice answer contains an unknown option" }
  }
  const rationaleLength = answer.rationale?.length ?? 0
  const requiredMinimum = interaction.rationale.required
    ? Math.max(1, interaction.rationale.minLength ?? 1)
    : interaction.rationale.minLength ?? 0
  if (rationaleLength < requiredMinimum) {
    return { ok: false, error: "A longer explanation is required" }
  }
  if (rationaleLength > interaction.rationale.maxLength) {
    return { ok: false, error: "The explanation is too long" }
  }

  const labels = answer.optionIds.map((id) => optionsById.get(id)?.label ?? id)
  const choice =
    answer.mode === "rank"
      ? `Ranked: ${labels.map((label, index) => `${index + 1}. ${label}`).join("; ")}`
      : `${answer.mode === "remove" ? "Removed" : "Selected"}: ${labels.join(", ")}`
  const retained = answer.mode === "remove"
    ? interaction.options
        .filter((option) => !answer.optionIds.includes(option.id))
        .map((option) => option.label)
    : []
  const completeChoice = retained.length
    ? `${choice}\nRetained: ${retained.join(", ")}`
    : choice
  return {
    ok: true,
    answer,
    message: answer.rationale ? `${completeChoice}\nReason: ${answer.rationale}` : completeChoice,
  }
}

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
  let mediaChoice = normaliseMediaChoiceInteraction(raw.mediaChoice)
  if (STRUCTURED_INPUT_TYPES.has(inputType) && !options) {
    inputType = "text"
    options = undefined
  }
  if (inputType === "mediaChoice" && !mediaChoice) {
    inputType = "text"
    mediaChoice = undefined
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
    ...(mediaChoice ? { mediaChoice } : {}),
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
