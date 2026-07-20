import { describe, expect, it } from "vitest"
import {
  DEFAULT_APPLICATION_CLOSING_MESSAGE,
  DEFAULT_ONBOARDING_EXPERIENCE,
  defaultOnboardingSteps,
  parseApplicationExperience,
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

  it("accepts full gatekeeper application experience config", () => {
    const r = validateProjectSettings({
      project_type: "gatekeeper",
      application_experience: {
        opening_message: "Welcome to COLORS.",
        closing_message: "Thanks. We'll follow up soon.",
        opening_interaction: {
          inputType: "singleSelect",
          options: ["Artist", "Curator"],
        },
        required_signals: ["intent", "contribution"],
        preferred_input_types: ["text", "singleSelect"],
        max_turns: 4,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.application_experience).toEqual({
        opening_message: "Welcome to COLORS.",
        closing_message: "Thanks. We'll follow up soon.",
        opening_interaction: {
          inputType: "singleSelect",
          options: ["Artist", "Curator"],
        },
        required_signals: ["intent", "contribution"],
        preferred_input_types: ["text", "singleSelect"],
        max_turns: 4,
      })
    }
  })

  it("preserves full application questions used as ordered signals", () => {
    const question =
      "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?"
    const parsed = parseApplicationExperience({
      application_experience: { required_signals: [question] },
    })
    expect(parsed.required_signals).toEqual([question])
  })

  it("applies the default neutral application closing message", () => {
    const r = validateProjectSettings({
      project_type: "gatekeeper",
      application_experience: {
        opening_message: "Welcome.",
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.application_experience).toEqual({
        opening_message: "Welcome.",
      })
    }

    expect(
      parseApplicationExperience({
        application_experience: { opening_message: "Welcome." },
      }).closing_message,
    ).toBe(DEFAULT_APPLICATION_CLOSING_MESSAGE)
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
      expect(r.settings.onboarding_experience).toEqual(
        DEFAULT_ONBOARDING_EXPERIENCE,
      )
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
            interaction: {
              inputType: "singleSelect",
              options: ["Discover", "Community", "Share Work"],
            },
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
      expect(fc.steps[0].interaction).toEqual({
        inputType: "singleSelect",
        options: ["Discover", "Community", "Share Work"],
      })
      expect(fc.steps[0].min_answer_chars).toBe(30)
    }
  })
})
