import { describe, expect, it } from "vitest"
import type { StartSessionResponse } from "../client.js"
import { turnFromStartResponse } from "../react/gatekeeper-turn.js"

function startResponse(
  overrides: Partial<StartSessionResponse> = {},
): StartSessionResponse {
  return {
    message: "What brought you here?",
    status: "active",
    projectType: "gatekeeper",
    bootstrapped: true,
    ...overrides,
  }
}

describe("GatekeeperV2 bootstrap turn", () => {
  it("preserves the configured single-select interaction", () => {
    const ui = {
      intent: "probe" as const,
      inputType: "singleSelect" as const,
      emotionalState: "neutral" as const,
      visualState: "curious" as const,
      options: ["Discover", "Community", "Share Work"],
    }

    expect(turnFromStartResponse(startResponse({ ui }))).toEqual({
      message: "What brought you here?",
      ui,
    })
  })

  it("falls back to a text interaction for older start responses", () => {
    expect(turnFromStartResponse(startResponse())).toEqual({
      message: "What brought you here?",
      ui: {
        intent: "probe",
        inputType: "text",
        emotionalState: "neutral",
        visualState: "idle",
      },
    })
  })
})
