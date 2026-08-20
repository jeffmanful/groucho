/**
 * Project settings helpers: `project_type`, application/onboarding experience, validation.
 */

export type ProjectType = "gatekeeper" | "onboarding"

export const DEFAULT_APPLICATION_OPENING_MESSAGE =
  "What brings you here, and what do you think you would add?"
export const DEFAULT_APPLICATION_CLOSING_MESSAGE =
  "It was good getting to understand you better."

export type ApplicationOpeningInputType = "text" | "singleSelect" | "multiSelect"

export type ApplicationOpeningInteraction = {
  inputType: ApplicationOpeningInputType
  options?: string[]
}

export type ApplicationExperience = {
  opening_message: string
  closing_message?: string
  opening_interaction?: ApplicationOpeningInteraction
  required_signals?: string[]
  preferred_input_types?: ApplicationOpeningInputType[]
  max_turns?: number
}

export const MAX_REQUIRED_SIGNALS = 12
export const MAX_SIGNAL_LENGTH = 240
export const MIN_APPLICATION_MAX_TURNS = 1
export const MAX_APPLICATION_MAX_TURNS = 12

const APPLICATION_INPUT_TYPES = new Set<ApplicationOpeningInputType>([
  "text",
  "singleSelect",
  "multiSelect",
])

export type OnboardingFlowStep = {
  id: string
  title: string
  question: string
  profile_key: string
  required: boolean
  interaction?: ApplicationOpeningInteraction
  intro?: string
  hint?: string
  followup_prompt?: string
  min_answer_chars?: number
}

export type OnboardingFlowConfig = {
  version: string
  welcome_message?: string
  steps: OnboardingFlowStep[]
}

export type OnboardingExperience = {
  bridge_enabled: boolean
  followup_enabled: boolean
  boundary_enabled: boolean
  personalized_completion: boolean
}

export type NormalizedProjectSettings = {
  projectType: ProjectType
  applicationExperience: ApplicationExperience
  flowConfig: OnboardingFlowConfig | null
  onboardingExperience: OnboardingExperience
  raw: Record<string, unknown>
}

const STEP_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/
const PROFILE_KEY_RE = /^[a-z][a-z0-9_]{0,47}$/
const DEFAULT_MIN_ANSWER_CHARS = 24

export const DEFAULT_ONBOARDING_EXPERIENCE: OnboardingExperience = {
  bridge_enabled: false,
  followup_enabled: true,
  boundary_enabled: false,
  personalized_completion: false,
}

function parseApplicationOpeningInteraction(
  raw: unknown,
): ApplicationOpeningInteraction | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const inputType =
    typeof o.inputType === "string" &&
    APPLICATION_INPUT_TYPES.has(o.inputType as ApplicationOpeningInputType)
      ? (o.inputType as ApplicationOpeningInputType)
      : null
  if (!inputType) return undefined

  if (inputType === "text") {
    return { inputType: "text" }
  }

  const optionsRaw = o.options
  if (!Array.isArray(optionsRaw)) return undefined
  const options = optionsRaw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
  if (!options.length) return undefined

  return { inputType, options }
}

function parseRequiredSignals(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const signals = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_REQUIRED_SIGNALS)
    .map((item) => item.slice(0, MAX_SIGNAL_LENGTH))
  return signals.length > 0 ? signals : undefined
}

function parsePreferredInputTypes(
  raw: unknown,
): ApplicationOpeningInputType[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const types = raw.filter(
    (item): item is ApplicationOpeningInputType =>
      typeof item === "string" &&
      APPLICATION_INPUT_TYPES.has(item as ApplicationOpeningInputType),
  )
  const unique = [...new Set(types)]
  return unique.length > 0 ? unique : undefined
}

function parseApplicationMaxTurns(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined
  const turns = Math.floor(raw)
  if (turns < MIN_APPLICATION_MAX_TURNS || turns > MAX_APPLICATION_MAX_TURNS) {
    return undefined
  }
  return turns
}

export function parseApplicationExperience(
  settings: unknown,
): ApplicationExperience {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {
      opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
      closing_message: DEFAULT_APPLICATION_CLOSING_MESSAGE,
    }
  }
  const raw = (settings as Record<string, unknown>).application_experience
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
      closing_message: DEFAULT_APPLICATION_CLOSING_MESSAGE,
    }
  }
  const o = raw as Record<string, unknown>
  const opening = parseOptionalString(o, "opening_message", 500)
  const closing = parseOptionalString(o, "closing_message", 500)
  const opening_interaction = parseApplicationOpeningInteraction(o.opening_interaction)
  const required_signals = parseRequiredSignals(o.required_signals)
  const preferred_input_types = parsePreferredInputTypes(o.preferred_input_types)
  const max_turns = parseApplicationMaxTurns(o.max_turns)

  return {
    opening_message: opening ?? DEFAULT_APPLICATION_OPENING_MESSAGE,
    closing_message: closing ?? DEFAULT_APPLICATION_CLOSING_MESSAGE,
    ...(opening_interaction ? { opening_interaction } : {}),
    ...(required_signals ? { required_signals } : {}),
    ...(preferred_input_types ? { preferred_input_types } : {}),
    ...(max_turns !== undefined ? { max_turns } : {}),
  }
}

export function serializeApplicationExperienceForStorage(
  app: ApplicationExperience,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  if (app.opening_message !== DEFAULT_APPLICATION_OPENING_MESSAGE) {
    out.opening_message = app.opening_message
  }
  if (
    app.closing_message &&
    app.closing_message !== DEFAULT_APPLICATION_CLOSING_MESSAGE
  ) {
    out.closing_message = app.closing_message
  }
  if (app.opening_interaction) {
    out.opening_interaction = {
      inputType: app.opening_interaction.inputType,
      ...(app.opening_interaction.options?.length
        ? { options: app.opening_interaction.options }
        : {}),
    }
  }
  if (app.required_signals?.length) {
    out.required_signals = app.required_signals
  }
  if (app.preferred_input_types?.length) {
    out.preferred_input_types = app.preferred_input_types
  }
  if (app.max_turns !== undefined) {
    out.max_turns = app.max_turns
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export type ApplicationExperienceFormInput = {
  openingMessage: string
  closingMessage: string
  openingInputType: "" | ApplicationOpeningInputType
  openingOptions: string
  requiredSignals: string
  preferredInputTypes: ApplicationOpeningInputType[]
  maxTurns: number | ""
}

export function buildApplicationExperienceFromForm(
  input: ApplicationExperienceFormInput,
): ApplicationExperience {
  const opening_message =
    input.openingMessage.trim() || DEFAULT_APPLICATION_OPENING_MESSAGE
  const closing_message =
    input.closingMessage.trim() || DEFAULT_APPLICATION_CLOSING_MESSAGE

  let opening_interaction: ApplicationOpeningInteraction | undefined
  if (input.openingInputType === "text") {
    opening_interaction = { inputType: "text" }
  } else if (
    input.openingInputType === "singleSelect" ||
    input.openingInputType === "multiSelect"
  ) {
    const options = input.openingOptions
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12)
    if (options.length) {
      opening_interaction = {
        inputType: input.openingInputType,
        options,
      }
    }
  }

  const required_signals = parseRequiredSignals(
    input.requiredSignals
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  )

  const preferred_input_types = input.preferredInputTypes.length
    ? [...new Set(input.preferredInputTypes)]
    : undefined

  const max_turns =
    typeof input.maxTurns === "number" && Number.isFinite(input.maxTurns)
      ? parseApplicationMaxTurns(Math.floor(input.maxTurns))
      : undefined

  return {
    opening_message,
    closing_message,
    ...(opening_interaction ? { opening_interaction } : {}),
    ...(required_signals ? { required_signals } : {}),
    ...(preferred_input_types ? { preferred_input_types } : {}),
    ...(max_turns !== undefined ? { max_turns } : {}),
  }
}

export function parseOnboardingExperience(
  settings: unknown,
): OnboardingExperience {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { ...DEFAULT_ONBOARDING_EXPERIENCE }
  }
  const raw = (settings as Record<string, unknown>).onboarding_experience
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_ONBOARDING_EXPERIENCE }
  }
  const o = raw as Record<string, unknown>
  return {
    bridge_enabled:
      typeof o.bridge_enabled === "boolean"
        ? o.bridge_enabled
        : DEFAULT_ONBOARDING_EXPERIENCE.bridge_enabled,
    followup_enabled:
      typeof o.followup_enabled === "boolean"
        ? o.followup_enabled
        : DEFAULT_ONBOARDING_EXPERIENCE.followup_enabled,
    boundary_enabled:
      typeof o.boundary_enabled === "boolean"
        ? o.boundary_enabled
        : DEFAULT_ONBOARDING_EXPERIENCE.boundary_enabled,
    personalized_completion:
      typeof o.personalized_completion === "boolean"
        ? o.personalized_completion
        : DEFAULT_ONBOARDING_EXPERIENCE.personalized_completion,
  }
}

function parseOptionalString(
  o: Record<string, unknown>,
  key: string,
  maxLen: number,
): string | undefined {
  const v = o[key]
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return undefined
  return t.slice(0, maxLen)
}

function parseStep(raw: unknown, index: number): OnboardingFlowStep | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `Step ${index + 1}: must be an object`
  }
  const o = raw as Record<string, unknown>
  const id = typeof o.id === "string" ? o.id.trim() : ""
  const title = typeof o.title === "string" ? o.title.trim() : ""
  const question = typeof o.question === "string" ? o.question.trim() : ""
  const profile_key =
    typeof o.profile_key === "string" ? o.profile_key.trim() : ""
  const required = o.required !== false

  if (!id || !STEP_ID_RE.test(id)) {
    return `Step ${index + 1}: id must match ${STEP_ID_RE.source}`
  }
  if (!title || title.length > 64) {
    return `Step ${index + 1}: title required (max 64 chars)`
  }
  if (!question || question.length > 500) {
    return `Step ${index + 1}: question required (max 500 chars)`
  }
  if (!profile_key || !PROFILE_KEY_RE.test(profile_key)) {
    return `Step ${index + 1}: profile_key must match ${PROFILE_KEY_RE.source}`
  }

  const intro = parseOptionalString(o, "intro", 200)
  const hint = parseOptionalString(o, "hint", 120)
  const followup_prompt = parseOptionalString(o, "followup_prompt", 300)
  const interaction = parseApplicationOpeningInteraction(o.interaction)

  let min_answer_chars: number | undefined
  if (typeof o.min_answer_chars === "number" && Number.isFinite(o.min_answer_chars)) {
    min_answer_chars = Math.min(500, Math.max(0, Math.floor(o.min_answer_chars)))
  }

  const step: OnboardingFlowStep = {
    id,
    title,
    question,
    profile_key,
    required,
  }
  if (intro) step.intro = intro
  if (hint) step.hint = hint
  if (interaction) step.interaction = interaction
  if (followup_prompt) step.followup_prompt = followup_prompt
  if (min_answer_chars !== undefined) step.min_answer_chars = min_answer_chars

  return step
}

export function parseProjectType(settings: unknown): ProjectType {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return "gatekeeper"
  }
  const t = (settings as Record<string, unknown>).project_type
  return t === "onboarding" ? "onboarding" : "gatekeeper"
}

export function parseFlowConfig(settings: unknown): OnboardingFlowConfig | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null
  }
  const fc = (settings as Record<string, unknown>).flow_config
  if (!fc || typeof fc !== "object" || Array.isArray(fc)) return null
  const o = fc as Record<string, unknown>
  const version =
    typeof o.version === "string" && o.version.trim()
      ? o.version.trim()
      : "2026-05-21"
  const stepsRaw = o.steps
  if (!Array.isArray(stepsRaw)) return null

  const steps: OnboardingFlowStep[] = []
  for (let i = 0; i < stepsRaw.length; i++) {
    const parsed = parseStep(stepsRaw[i], i)
    if (typeof parsed === "string") return null
    steps.push(parsed)
  }

  const welcome_message = parseOptionalString(o, "welcome_message", 280)

  return {
    version,
    steps,
    ...(welcome_message ? { welcome_message } : {}),
  }
}

export function normalizeProjectSettings(
  settings: unknown,
): NormalizedProjectSettings {
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {}
  const projectType = parseProjectType(raw)
  const applicationExperience = parseApplicationExperience(raw)
  const flowConfig =
    projectType === "onboarding" ? parseFlowConfig(raw) : null
  const onboardingExperience = parseOnboardingExperience(raw)
  return {
    projectType,
    applicationExperience,
    flowConfig,
    onboardingExperience,
    raw,
  }
}

/**
 * Flow config for runtime (chat/start). Falls back to default steps when the project
 * is onboarding but stored flow_config is missing or failed strict parse.
 */
export function resolveRuntimeFlowConfig(
  settings: NormalizedProjectSettings,
): OnboardingFlowConfig | null {
  if (settings.projectType !== "onboarding") return null

  if (settings.flowConfig?.steps.length) {
    return settings.flowConfig
  }

  const version =
    settings.flowConfig?.version ??
    (typeof settings.raw.flow_config === "object" &&
    settings.raw.flow_config !== null &&
    !Array.isArray(settings.raw.flow_config) &&
    typeof (settings.raw.flow_config as Record<string, unknown>).version ===
      "string"
      ? String((settings.raw.flow_config as Record<string, unknown>).version).trim()
      : "2026-05-21")

  const welcome_message = settings.flowConfig?.welcome_message

  return {
    version,
    steps: defaultOnboardingSteps(),
    ...(welcome_message ? { welcome_message } : {}),
  }
}

export function stepMinAnswerChars(step: OnboardingFlowStep): number {
  return step.min_answer_chars ?? DEFAULT_MIN_ANSWER_CHARS
}

/** Compose assistant-facing text for a step (intro + question). */
export function formatStepPrompt(
  step: OnboardingFlowStep,
  welcomePrefix?: string,
): string {
  const parts: string[] = []
  if (welcomePrefix?.trim()) parts.push(welcomePrefix.trim())
  if (step.intro?.trim()) parts.push(step.intro.trim())
  parts.push(step.question)
  return parts.join("\n\n")
}

export type ValidateSettingsResult =
  | { ok: true; settings: Record<string, unknown> }
  | { ok: false; error: string }

function serializeStep(s: OnboardingFlowStep): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: s.id,
    title: s.title,
    question: s.question,
    profile_key: s.profile_key,
    required: s.required,
  }
  if (s.intro) out.intro = s.intro
  if (s.hint) out.hint = s.hint
  if (s.interaction) {
    out.interaction = {
      inputType: s.interaction.inputType,
      ...(s.interaction.options?.length ? { options: s.interaction.options } : {}),
    }
  }
  if (s.followup_prompt) out.followup_prompt = s.followup_prompt
  if (s.min_answer_chars !== undefined) out.min_answer_chars = s.min_answer_chars
  return out
}

/**
 * Validates and normalizes settings on project create/update.
 */
export function validateProjectSettings(
  settings: Record<string, unknown>,
): ValidateSettingsResult {
  const projectTypeRaw = settings.project_type
  const projectType: ProjectType =
    projectTypeRaw === "onboarding" ? "onboarding" : "gatekeeper"

  const out: Record<string, unknown> = { ...settings, project_type: projectType }

  if (projectType === "gatekeeper") {
    delete out.flow_config
    delete out.onboarding_experience
    const app = parseApplicationExperience(settings)
    const serialized = serializeApplicationExperienceForStorage(app)
    if (serialized) {
      out.application_experience = serialized
    } else {
      delete out.application_experience
    }
    return { ok: true, settings: out }
  }

  delete out.application_experience

  const fc = settings.flow_config
  if (!fc || typeof fc !== "object" || Array.isArray(fc)) {
    return { ok: false, error: "Onboarding projects require flow_config with steps." }
  }

  const o = fc as Record<string, unknown>
  const version =
    typeof o.version === "string" && o.version.trim()
      ? o.version.trim().slice(0, 32)
      : "2026-05-21"
  const stepsRaw = o.steps
  if (!Array.isArray(stepsRaw)) {
    return { ok: false, error: "flow_config.steps must be an array." }
  }
  if (stepsRaw.length < 1 || stepsRaw.length > 12) {
    return { ok: false, error: "Onboarding flow must have between 1 and 12 steps." }
  }

  const steps: OnboardingFlowStep[] = []
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()

  for (let i = 0; i < stepsRaw.length; i++) {
    const parsed = parseStep(stepsRaw[i], i)
    if (typeof parsed === "string") {
      return { ok: false, error: parsed }
    }
    if (seenIds.has(parsed.id)) {
      return { ok: false, error: `Duplicate step id: ${parsed.id}` }
    }
    if (seenKeys.has(parsed.profile_key)) {
      return { ok: false, error: `Duplicate profile_key: ${parsed.profile_key}` }
    }
    seenIds.add(parsed.id)
    seenKeys.add(parsed.profile_key)
    steps.push(parsed)
  }

  const welcome_message = parseOptionalString(o, "welcome_message", 280)
  const flowOut: Record<string, unknown> = {
    version,
    steps: steps.map(serializeStep),
  }
  if (welcome_message) flowOut.welcome_message = welcome_message
  out.flow_config = flowOut

  const exp = parseOnboardingExperience(settings)
  out.onboarding_experience = {
    bridge_enabled: exp.bridge_enabled,
    followup_enabled: exp.followup_enabled,
    boundary_enabled: exp.boundary_enabled,
    personalized_completion: exp.personalized_completion,
  }

  return { ok: true, settings: out }
}

export function defaultOnboardingSteps(): OnboardingFlowStep[] {
  return [
    {
      id: "intent",
      title: "Intent",
      question: "What are you hoping to find or contribute here?",
      profile_key: "intent",
      required: true,
    },
    {
      id: "interests",
      title: "Interests",
      question: "What topics or activities matter most to you in this community?",
      profile_key: "interests",
      required: true,
    },
    {
      id: "values",
      title: "Values",
      question: "What kind of space do you want to help maintain for others?",
      profile_key: "values",
      required: true,
    },
  ]
}

export function buildOnboardingProfileSchema(
  steps: OnboardingFlowStep[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const s of steps) {
    properties[s.profile_key] = {
      type: "string",
      description: `Answer from step "${s.title}": ${s.question}`,
    }
  }
  return {
    type: "object",
    properties,
    additionalProperties: false,
  }
}
