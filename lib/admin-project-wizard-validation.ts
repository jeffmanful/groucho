import type { ProjectSetupFormState } from "@/lib/admin-project-setup"
import { isValidProjectSlug } from "@/components/admin/project-setup-ui"

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
