import { describe, expect, it } from "vitest"
import {
  validateWizardStep1,
  validateWizardStep2,
} from "@/lib/admin-project-wizard-validation"

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
        flowSteps: [],
        webhookUrl: "",
        webhookEvents: [],
        passThreshold: 0.65,
        rejectThreshold: 0.25,
      }),
    ).toMatch(/persona/i)
  })
})
