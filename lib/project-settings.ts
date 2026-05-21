/**
 * Project settings helpers: `project_type`, onboarding `flow_config`, validation.
 */

export type ProjectType = "gatekeeper" | "onboarding"

export type OnboardingFlowStep = {
  id: string
  title: string
  question: string
  profile_key: string
  required: boolean
}

export type OnboardingFlowConfig = {
  version: string
  steps: OnboardingFlowStep[]
}

export type NormalizedProjectSettings = {
  projectType: ProjectType
  flowConfig: OnboardingFlowConfig | null
  raw: Record<string, unknown>
}

const STEP_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/
const PROFILE_KEY_RE = /^[a-z][a-z0-9_]{0,47}$/

export function parseProjectType(settings: unknown): ProjectType {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return "gatekeeper"
  }
  const t = (settings as Record<string, unknown>).project_type
  return t === "onboarding" ? "onboarding" : "gatekeeper"
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

  return { id, title, question, profile_key, required }
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
  return { version, steps }
}

export function normalizeProjectSettings(
  settings: unknown,
): NormalizedProjectSettings {
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {}
  const projectType = parseProjectType(raw)
  const flowConfig =
    projectType === "onboarding" ? parseFlowConfig(raw) : null
  return { projectType, flowConfig, raw }
}

export type ValidateSettingsResult =
  | { ok: true; settings: Record<string, unknown> }
  | { ok: false; error: string }

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
    return { ok: true, settings: out }
  }

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

  out.flow_config = { version, steps }
  return { ok: true, settings: out }
}

export function defaultOnboardingSteps(): OnboardingFlowStep[] {
  return [
    {
      id: "intent",
      title: "Intent",
      question: "What are you hoping to get out of joining?",
      profile_key: "intent",
      required: true,
    },
    {
      id: "interests",
      title: "Interests",
      question: "What topics or activities matter most to you here?",
      profile_key: "interests",
      required: true,
    },
    {
      id: "values",
      title: "Values",
      question: "What kind of community do you want to help maintain?",
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
