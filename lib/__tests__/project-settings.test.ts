import { describe, expect, it } from "vitest"
import {
  defaultOnboardingSteps,
  validateProjectSettings,
} from "@/lib/project-settings"

describe("validateProjectSettings", () => {
  it("accepts gatekeeper settings without flow_config", () => {
    const r = validateProjectSettings({
      project_type: "gatekeeper",
      persona_id: "p1",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.project_type).toBe("gatekeeper")
      expect(r.settings.flow_config).toBeUndefined()
    }
  })

  it("rejects onboarding without steps", () => {
    const r = validateProjectSettings({ project_type: "onboarding" })
    expect(r.ok).toBe(false)
  })

  it("rejects duplicate step ids", () => {
    const steps = defaultOnboardingSteps().map((s) => ({ ...s, id: "same" }))
    const r = validateProjectSettings({
      project_type: "onboarding",
      flow_config: { version: "1", steps },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("Duplicate")
  })

  it("accepts valid onboarding flow", () => {
    const r = validateProjectSettings({
      project_type: "onboarding",
      flow_config: { version: "2026-05-21", steps: defaultOnboardingSteps() },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.project_type).toBe("onboarding")
      const fc = r.settings.flow_config as { steps: unknown[] }
      expect(fc.steps).toHaveLength(3)
    }
  })
})
