import type { ProjectSetupFormState } from "@/lib/admin-project-setup"
import { isValidProjectSlug } from "@/components/admin/project-setup-ui"
import {
  MAX_APPLICATION_MAX_TURNS,
  MAX_REQUIRED_SIGNALS,
  MAX_SIGNAL_LENGTH,
  MIN_APPLICATION_MAX_TURNS,
} from "@/lib/project-settings"

export function validateWizardStep1(name: string, slug: string): string | null {
  const n = name.trim()
  if (n.length < 2 || n.length > 64) {
    return "Name must be between 2 and 64 characters."
  }
  if (!isValidProjectSlug(slug)) {
    return "Slug must be 2–31 characters: lowercase letters, numbers, and hyphens; start with a letter or digit."
  }
  return null
}

export function validateWizardStep2(form: ProjectSetupFormState): string | null {
  if (!form.personaId) {
    return "Select a persona before continuing."
  }
  if (form.projectType === "gatekeeper") {
    if (form.applicationOpeningMessage.trim().length > 500) {
      return "Application opening message must be 500 characters or fewer."
    }
    if (
      (form.applicationOpeningInputType === "singleSelect" ||
        form.applicationOpeningInputType === "multiSelect") &&
      !form.applicationOpeningOptions
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean).length
    ) {
      return "Opening interaction options are required for single or multi select."
    }
    const signals = form.applicationRequiredSignals
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (signals.length > MAX_REQUIRED_SIGNALS) {
      return `Required signals must be ${MAX_REQUIRED_SIGNALS} items or fewer.`
    }
    if (signals.some((signal) => signal.length > MAX_SIGNAL_LENGTH)) {
      return `Each required signal must be ${MAX_SIGNAL_LENGTH} characters or fewer.`
    }
    if (
      form.applicationMaxTurns !== "" &&
      (form.applicationMaxTurns < MIN_APPLICATION_MAX_TURNS ||
        form.applicationMaxTurns > MAX_APPLICATION_MAX_TURNS)
    ) {
      return `Max turns must be between ${MIN_APPLICATION_MAX_TURNS} and ${MAX_APPLICATION_MAX_TURNS}.`
    }
    return null
  }
  if (form.projectType !== "onboarding") return null

  for (let i = 0; i < form.flowSteps.length; i++) {
    const s = form.flowSteps[i]
    const n = i + 1
    if (!s.id.trim()) return `Onboarding step ${n}: step id is required.`
    if (!s.title.trim()) return `Onboarding step ${n}: title is required.`
    if (!s.question.trim()) return `Onboarding step ${n}: question is required.`
    if (!s.profile_key.trim()) return `Onboarding step ${n}: profile key is required.`
  }
  return null
}
