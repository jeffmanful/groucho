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

  it("accepts a gatekeeper opening message", () => {
    const r = validateProjectSettings({
      project_type: "gatekeeper",
      application_experience: {
        opening_message: "Welcome. A few questions first.",
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.application_experience).toEqual({
        opening_message: "Welcome. A few questions first.",
      })
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
      expect(r.settings.onboarding_experience).toBeTruthy()
    }
  })

  it("accepts welcome_message and step optional fields", () => {
    const r = validateProjectSettings({
      project_type: "onboarding",
      flow_config: {
        version: "2026-05-21",
        welcome_message: "Welcome.",
        steps: [
          {
            id: "intent",
            title: "Intent",
            question: "Why join?",
            profile_key: "intent",
            required: true,
            intro: "First, intent.",
            hint: "Be specific",
            followup_prompt: "More detail?",
            min_answer_chars: 30,
          },
        ],
      },
      onboarding_experience: {
        bridge_enabled: false,
        followup_enabled: true,
        boundary_enabled: true,
        personalized_completion: false,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const fc = r.settings.flow_config as {
        welcome_message?: string
        steps: Record<string, unknown>[]
      }
      expect(fc.welcome_message).toBe("Welcome.")
      expect(fc.steps[0].intro).toBe("First, intent.")
      expect(fc.steps[0].min_answer_chars).toBe(30)
    }
  })
})
