import { describe, expect, it } from "vitest"
import {
  buildProjectSettingsPayload,
  formStateFromProject,
} from "@/lib/admin-project-setup"

describe("formStateFromProject", () => {
  it("hydrates onboarding flow from settings", () => {
    const state = formStateFromProject({
      name: "Forum",
      slug: "forum",
      settings: {
        project_type: "onboarding",
        use_case: "community_gate",
        environment: "live",
        session_mode: "live",
        persona_id: "p1",
        flow_config: {
          version: "2026-05-21",
          steps: [
            {
              id: "intent",
              title: "Intent",
              question: "Why join?",
              profile_key: "intent",
              required: true,
            },
          ],
        },
        webhook_url: "https://example.com/hook",
        webhook_events: ["session.completed"],
        pass_threshold: 0.7,
        reject_threshold: 0.2,
      },
    })
    expect(state.projectType).toBe("onboarding")
    expect(state.environment).toBe("live")
    expect(state.flowSteps).toHaveLength(1)
    expect(state.flowSteps[0].question).toBe("Why join?")
    expect(state.webhookUrl).toBe("https://example.com/hook")
    expect(state.webhookEvents).toEqual(["session.completed"])
    expect(state.passThreshold).toBe(0.7)
  })

  it("defaults gatekeeper fields", () => {
    const state = formStateFromProject({
      name: "Gate",
      slug: "gate",
      settings: { project_type: "gatekeeper" },
    })
    expect(state.projectType).toBe("gatekeeper")
    expect(state.environment).toBe("test")
    expect(state.sessionMode).toBe("dry-run")
    expect(state.flowSteps).toEqual([])
  })

  it("hydrates onboarding steps leniently when strict parse would fail", () => {
    const state = formStateFromProject({
      name: "Forum",
      slug: "forum",
      settings: {
        project_type: "onboarding",
        flow_config: {
          version: "2026-05-21",
          steps: [
            {
              id: "INTENT",
              title: "Intent",
              question: "Why join?",
              profile_key: "intent",
            },
          ],
        },
      },
    })
    expect(state.flowSteps).toHaveLength(1)
    expect(state.flowSteps[0].question).toBe("Why join?")
  })
})

describe("buildProjectSettingsPayload", () => {
  it("preserves unknown keys and updates flow for onboarding", () => {
    const existing = {
      custom_flag: true,
      legacy: "x",
      flow_config: { version: "v1", steps: [] },
    }
    const form = formStateFromProject({
      name: "Forum",
      slug: "forum",
      settings: {
        project_type: "onboarding",
        persona_id: "p1",
        flow_config: {
          version: "v1",
          steps: [
            {
              id: "a",
              title: "A",
              question: "Q?",
              profile_key: "a",
              required: true,
              interaction: {
                inputType: "singleSelect",
                options: ["One", "Two"],
              },
            },
          ],
        },
      },
    })
    const out = buildProjectSettingsPayload(existing, form)
    expect(out.custom_flag).toBe(true)
    expect(out.legacy).toBe("x")
    expect(out.project_type).toBe("onboarding")
    expect(out.flow_config).toEqual({
      version: "v1",
      steps: [
        {
          id: "a",
          title: "A",
          question: "Q?",
          profile_key: "a",
          required: true,
          interaction: {
            inputType: "singleSelect",
            options: ["One", "Two"],
          },
        },
      ],
    })
    expect(out.onboarding_experience).toBeDefined()
  })

  it("removes flow_config for gatekeeper", () => {
    const existing = {
      project_type: "onboarding",
      flow_config: { version: "x", steps: [] },
    }
    const form = formStateFromProject({
      name: "G",
      slug: "g",
      settings: { project_type: "gatekeeper", persona_id: "p1" },
    })
    const out = buildProjectSettingsPayload(existing, form)
    expect(out.project_type).toBe("gatekeeper")
    expect(out.flow_config).toBeUndefined()
  })

  it("serializes custom gatekeeper opening message", () => {
    const form = formStateFromProject({
      name: "G",
      slug: "g",
      settings: {
        project_type: "gatekeeper",
        persona_id: "p1",
        application_experience: {
          opening_message: "Welcome. A few questions first.",
          closing_message: "Thanks. We'll follow up.",
        },
      },
    })
    const out = buildProjectSettingsPayload({}, form)
    expect(out.application_experience).toEqual({
      opening_message: "Welcome. A few questions first.",
      closing_message: "Thanks. We'll follow up.",
    })
  })

  it("round-trips gatekeeper application experience fields", () => {
    const form = formStateFromProject({
      name: "G",
      slug: "g",
      settings: {
        project_type: "gatekeeper",
        persona_id: "p1",
        application_experience: {
          opening_message: "Welcome to COLORS.",
          closing_message: "Thanks. We'll follow up.",
          opening_interaction: {
            inputType: "multiSelect",
            options: ["Artist", "Curator"],
          },
          required_signals: ["intent", "contribution"],
          preferred_input_types: ["text", "multiSelect"],
          max_turns: 5,
        },
      },
    })
    expect(form.applicationOpeningInputType).toBe("multiSelect")
    expect(form.applicationOpeningOptions).toBe("Artist\nCurator")
    expect(form.applicationRequiredSignals).toBe("intent\ncontribution")
    expect(form.applicationPreferredInputTypes).toEqual(["text", "multiSelect"])
    expect(form.applicationMaxTurns).toBe(5)

    const out = buildProjectSettingsPayload({}, form)
    expect(out.application_experience).toEqual({
      opening_message: "Welcome to COLORS.",
      closing_message: "Thanks. We'll follow up.",
      opening_interaction: {
        inputType: "multiSelect",
        options: ["Artist", "Curator"],
      },
      required_signals: ["intent", "contribution"],
      preferred_input_types: ["text", "multiSelect"],
      max_turns: 5,
    })
  })

  it("clears webhook fields when URL empty", () => {
    const existing = {
      webhook_url: "https://old.example/hook",
      webhook_events: ["verdict.created"],
    }
    const form = formStateFromProject({ name: "P", slug: "p", settings: {} })
    const out = buildProjectSettingsPayload(existing, {
      ...form,
      webhookUrl: "",
      webhookEvents: [],
    })
    expect(out.webhook_url).toBeUndefined()
    expect(out.webhook_events).toBeUndefined()
  })
})
