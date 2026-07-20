import { describe, expect, it } from "vitest"
import {
  validateWizardStep1,
  validateWizardStep2,
} from "@/lib/admin-project-wizard-validation"
import { DEFAULT_ONBOARDING_EXPERIENCE } from "@/lib/project-settings"

describe("validateWizardStep1", () => {
  it("rejects short name", () => {
    expect(validateWizardStep1("a", "valid-slug")).toMatch(/Name/)
  })

  it("rejects invalid slug", () => {
    expect(validateWizardStep1("Valid Name", "INVALID")).toMatch(/Slug/)
  })

  it("accepts valid input", () => {
    expect(validateWizardStep1("Forum gate", "forum-gate")).toBeNull()
  })
})

describe("validateWizardStep2", () => {
  it("requires persona", () => {
    expect(
      validateWizardStep2({
        name: "x",
        slug: "x",
        useCase: "other",
        projectType: "gatekeeper",
        environment: "test",
        sessionMode: "dry-run",
        personaId: "",
        applicationOpeningMessage: "Hi.",
        applicationClosingMessage: "Thanks. We'll be in touch.",
        applicationOpeningInputType: "",
        applicationOpeningOptions: "",
        applicationRequiredSignals: "",
        applicationPreferredInputTypes: [],
        applicationMaxTurns: "",
        flowSteps: [],
        welcomeMessage: "",
        onboardingExperience: { ...DEFAULT_ONBOARDING_EXPERIENCE },
        webhookUrl: "",
        webhookEvents: [],
        passThreshold: 0.65,
        rejectThreshold: 0.25,
      }),
    ).toMatch(/persona/i)
  })
})
