import type { OnboardingFlowStep } from "@/lib/project-settings"
import { slugify } from "@/components/admin/project-setup-ui"

const STEP_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/
const PROFILE_KEY_RE = /^[a-z][a-z0-9_]{0,47}$/

/** Derive step metadata from question text (simple editor mode). */
export function stepFieldsFromQuestion(
  question: string,
  index: number,
): OnboardingFlowStep {
  const q = question.trim()
  const rawSlug = slugify(q).replace(/-/g, "_").slice(0, 31)
  let id = rawSlug && STEP_ID_RE.test(rawSlug) ? rawSlug : `step_${index + 1}`
  if (!STEP_ID_RE.test(id)) id = `step_${index + 1}`

  let profile_key = id.replace(/-/g, "_")
  if (!PROFILE_KEY_RE.test(profile_key)) profile_key = `field_${index + 1}`

  const titleSource = q.replace(/\?+$/, "").trim()
  const title =
    titleSource.length > 64
      ? `${titleSource.slice(0, 61)}…`
      : titleSource || `Step ${index + 1}`

  return {
    id,
    title,
    question: q,
    profile_key,
    required: true,
  }
}

export function stepsFromQuestionLines(text: string): OnboardingFlowStep[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  return ensureUniqueStepIds(lines.map((line, i) => stepFieldsFromQuestion(line, i)))
}

export function ensureUniqueStepIds(steps: OnboardingFlowStep[]): OnboardingFlowStep[] {
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  return steps.map((step, index) => {
    let id = step.id.trim() || `step_${index + 1}`
    let profile_key = step.profile_key.trim() || id.replace(/-/g, "_")

    if (seenIds.has(id)) id = `${id}_${index + 1}`
    if (seenKeys.has(profile_key)) profile_key = `${profile_key}_${index + 1}`

    seenIds.add(id)
    seenKeys.add(profile_key)
    return { ...step, id, profile_key }
  })
}

/** Simple-mode list: one string per step (the question). */
export function questionsFromSteps(steps: OnboardingFlowStep[]): string[] {
  return steps.map((s) => s.question)
}

export function stepsFromSimpleQuestions(
  questions: string[],
  previous: OnboardingFlowStep[],
): OnboardingFlowStep[] {
  const next = questions.map((raw, i) => {
    const q = raw.trim()
    const prev = previous[i]
    if (!q) {
      return (
        prev ?? {
          id: `step_${i + 1}`,
          title: `Step ${i + 1}`,
          question: "",
          profile_key: `field_${i + 1}`,
          required: true,
        }
      )
    }
    if (prev && prev.question.trim() === q) return prev
    return stepFieldsFromQuestion(q, i)
  })
  return ensureUniqueStepIds(next)
}

/** Update question text only — keeps ids/keys stable while typing (fast simple editor). */
export function syncQuestionTextsToSteps(
  questions: string[],
  previous: OnboardingFlowStep[],
): OnboardingFlowStep[] {
  const next = questions.map((raw, i) => {
    const prev = previous[i]
    if (prev) {
      return { ...prev, question: raw }
    }
    const trimmed = raw.trim()
    if (!trimmed) {
      return {
        id: `step_${i + 1}`,
        title: `Step ${i + 1}`,
        question: "",
        profile_key: `field_${i + 1}`,
        required: true,
      }
    }
    return stepFieldsFromQuestion(trimmed, i)
  })
  return ensureUniqueStepIds(next)
}

/** After blur or when adding a new step, normalize ids/titles from question text. */
export function normalizeSimpleQuestions(
  questions: string[],
  previous: OnboardingFlowStep[],
): OnboardingFlowStep[] {
  return stepsFromSimpleQuestions(
    questions.map((q) => q.trim()),
    previous,
  )
}
