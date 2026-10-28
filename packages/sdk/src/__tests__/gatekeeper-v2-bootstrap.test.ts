import { describe, expect, it } from "vitest"
import type { StartSessionResponse } from "../client.js"
import { gatekeeperRestoration, turnFromStartResponse } from "../react/gatekeeper-turn.js"

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

describe("browser-bound session restoration", () => {
  const applicant = { email: "synthetic@example.test", details: { city: "Example City", age: 27, socialLinks: [], musicLinks: [] } }
  it("restores submitted intake and the actual neutral close without another application", () => {
    const restored = gatekeeperRestoration({ status: "completed", message: "Thank you for taking part.", applicant }, "community")
    expect(restored?.outcome).toBe("completed")
    expect(restored?.turn?.message).toBe("Thank you for taking part.")
    expect(restored?.applicant).toEqual(applicant)
  })
  it("restores active intake while leaving the resume prompt to the start route", () => {
    expect(gatekeeperRestoration({ status: "active", applicant }, "community")).toEqual({ applicant, outcome: "active", turn: null })
  })
  it("does not invent a close or use intake belonging to another audience or email", () => {
    expect(gatekeeperRestoration({ status: "completed", applicant }, "community")).toBeNull()
    expect(gatekeeperRestoration({ status: "active", applicant }, "artist")).toBeNull()
    expect(gatekeeperRestoration({ status: "active", applicant }, "community", "different@example.test")).toBeNull()
  })
})
