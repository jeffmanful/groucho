import { describe, expect, it } from "vitest"
import {
  computeTerminalStatusFromGatekeeperTurn,
  parseAssistantStructuredMeta,
} from "@/lib/gatekeeper-session-status"

describe("computeTerminalStatusFromGatekeeperTurn", () => {
  const scores = {
    specificity: 0.8,
    authenticity: 0.8,
    cultural_depth: 0.8,
    overall: 0.9,
  }

  it("uses structured pass with threshold", () => {
    expect(
      computeTerminalStatusFromGatekeeperTurn({
        assistantContent: "ok",
        scores: { ...scores, overall: 0.5 },
        passThreshold: 0.65,
        rejectThreshold: 0.25,
        structuredToolUsed: true,
        structuredTerminal: "pass",
      }),
    ).toBe("redirected")
    expect(
      computeTerminalStatusFromGatekeeperTurn({
        assistantContent: "ok",
        scores,
        passThreshold: 0.65,
        rejectThreshold: 0.25,
        structuredToolUsed: true,
        structuredTerminal: "pass",
      }),
    ).toBe("passed")
  })

  it("falls back to legacy Yeah. Here.", () => {
    expect(
      computeTerminalStatusFromGatekeeperTurn({
        assistantContent: "Yeah. Here.",
        scores,
        passThreshold: 0.65,
        rejectThreshold: 0.25,
      }),
    ).toBe("passed")
  })
})

describe("parseAssistantStructuredMeta", () => {
  it("reads gatekeeper_terminal", () => {
    expect(
      parseAssistantStructuredMeta({
        gatekeeper_structured: true,
        gatekeeper_terminal: "reject",
      }),
    ).toEqual({ terminal: "reject", toolUsed: true })
  })
})
