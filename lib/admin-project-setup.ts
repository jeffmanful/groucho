import {
  defaultOnboardingSteps,
  parseFlowConfig,
  parseProjectType,
  type OnboardingFlowStep,
  type ProjectType,
} from "@/lib/project-settings"

/** Best-effort step parse for admin forms (keeps partial/legacy rows). */
function parseFlowStepsForForm(settings: Record<string, unknown>): OnboardingFlowStep[] {
  const strict = parseFlowConfig(settings)
  if (strict?.steps.length) return strict.steps

  const fc = settings.flow_config
  if (!fc || typeof fc !== "object" || Array.isArray(fc)) return []

  const stepsRaw = (fc as Record<string, unknown>).steps
  if (!Array.isArray(stepsRaw)) return []

  const steps: OnboardingFlowStep[] = []
  for (let i = 0; i < stepsRaw.length; i++) {
    const raw = stepsRaw[i]
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const o = raw as Record<string, unknown>
    const question = typeof o.question === "string" ? o.question : ""
    const id =
      typeof o.id === "string" && o.id.trim()
        ? o.id.trim()
        : `step_${i + 1}`
    const title =
      typeof o.title === "string" && o.title.trim()
        ? o.title.trim()
        : `Step ${i + 1}`
    const profile_key =
      typeof o.profile_key === "string" && o.profile_key.trim()
        ? o.profile_key.trim()
        : id.replace(/-/g, "_")
    steps.push({
      id,
      title,
      question,
      profile_key,
      required: o.required !== false,
    })
  }
  return steps
}

export const PROJECT_USE_CASES = [
  { id: "community_gate", label: "Community gate" },
  { id: "b2b_trial", label: "B2B trial" },
  { id: "event_access", label: "Event access" },
  { id: "other", label: "Other" },
] as const

export type ProjectUseCaseId = (typeof PROJECT_USE_CASES)[number]["id"]

export type ProjectSetupFormState = {
  name: string
  slug: string
  useCase: ProjectUseCaseId
  projectType: ProjectType
  environment: "test" | "live"
  sessionMode: "live" | "dry-run"
  personaId: string
  flowSteps: OnboardingFlowStep[]
  webhookUrl: string
  webhookEvents: string[]
  passThreshold: number
  rejectThreshold: number
}

const USE_CASE_IDS = new Set(PROJECT_USE_CASES.map((u) => u.id))

function parseUseCase(settings: Record<string, unknown>): ProjectUseCaseId {
  const u = settings.use_case
  return typeof u === "string" && USE_CASE_IDS.has(u as ProjectUseCaseId)
    ? (u as ProjectUseCaseId)
    : "community_gate"
}

function parseEnvironment(
  settings: Record<string, unknown>,
): "test" | "live" {
  return settings.environment === "live" ? "live" : "test"
}

function parseSessionMode(
  settings: Record<string, unknown>,
): "live" | "dry-run" {
  return settings.session_mode === "live" ? "live" : "dry-run"
}

function parseThreshold(
  settings: Record<string, unknown>,
  key: "pass_threshold" | "reject_threshold",
  fallback: number,
): number {
  const v = settings[key]
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(1, Math.max(0, v))
    : fallback
}

/** Hydrate wizard/edit form fields from a project row. */
export function formStateFromProject(row: {
  name: string
  slug: string
  settings?: unknown
}): ProjectSetupFormState {
  const settings =
    row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
      ? (row.settings as Record<string, unknown>)
      : {}

  const projectType = parseProjectType(settings)
  const flowStepsFromDb = parseFlowStepsForForm(settings)

  let webhookUrl = ""
  let webhookEvents: string[] = []
  if (typeof settings.webhook_url === "string") {
    webhookUrl = settings.webhook_url
  }
  if (Array.isArray(settings.webhook_events)) {
    webhookEvents = settings.webhook_events.filter(
      (e): e is string => typeof e === "string",
    )
  }

  return {
    name: row.name ?? "",
    slug: row.slug ?? "",
    useCase: parseUseCase(settings),
    projectType,
    environment: parseEnvironment(settings),
    sessionMode: parseSessionMode(settings),
    personaId: typeof settings.persona_id === "string" ? settings.persona_id : "",
    flowSteps:
      projectType === "onboarding"
        ? flowStepsFromDb.length > 0
          ? flowStepsFromDb
          : defaultOnboardingSteps()
        : [],
    webhookUrl,
    webhookEvents,
    passThreshold: parseThreshold(settings, "pass_threshold", 0.65),
    rejectThreshold: parseThreshold(settings, "reject_threshold", 0.25),
  }
}

/** Build settings JSON for POST/PATCH from form state (preserves unknown keys). */
export function buildProjectSettingsPayload(
  existing: Record<string, unknown> | undefined,
  form: ProjectSetupFormState,
): Record<string, unknown> {
  const base = { ...(existing ?? {}) }

  const settings: Record<string, unknown> = {
    ...base,
    project_type: form.projectType,
    use_case: form.useCase,
    environment: form.environment,
    session_mode: form.sessionMode,
    persona_id: form.personaId,
    pass_threshold: form.passThreshold,
    reject_threshold: form.rejectThreshold,
  }

  if (form.projectType === "onboarding") {
    settings.flow_config = {
      version:
        (base.flow_config &&
        typeof base.flow_config === "object" &&
        !Array.isArray(base.flow_config) &&
        typeof (base.flow_config as Record<string, unknown>).version === "string"
          ? String((base.flow_config as Record<string, unknown>).version).trim()
          : null) || "2026-05-21",
      steps: form.flowSteps.map((s) => ({
        id: s.id.trim(),
        title: s.title.trim(),
        question: s.question.trim(),
        profile_key: s.profile_key.trim(),
        required: s.required !== false,
      })),
    }
  } else {
    delete settings.flow_config
  }

  const url = form.webhookUrl.trim()
  if (url) {
    settings.webhook_url = url
    settings.webhook_events = form.webhookEvents
  } else {
    delete settings.webhook_url
    delete settings.webhook_events
  }

  return settings
}
