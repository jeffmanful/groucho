import { describe, expect, it } from "vitest"
import {
  computeTerminalStatusFromGatekeeperTurn,
  forcedCloseStatusFromScores,
  parseAssistantStructuredMeta,
  terminalFieldForSessionStatus,
} from "@/lib/gatekeeper-session-status"

describe("computeTerminalStatusFromGatekeeperTurn", () => {
  const scores = {
    specificity: 0.8,
    authenticity: 0.8,
    cultural_depth: 0.8,
    overall: 0.9,
  }

  it("uses the structured terminal decision directly", () => {
    expect(
      computeTerminalStatusFromGatekeeperTurn({
        assistantContent: "ok",
        scores: { ...scores, overall: 0.5 },
        passThreshold: 0.65,
        rejectThreshold: 0.25,
        structuredToolUsed: true,
        structuredTerminal: "pass",
      }),
    ).toBe("passed")
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
    expect(
      computeTerminalStatusFromGatekeeperTurn({
        assistantContent: "ok",
        scores: { ...scores, overall: 0.9 },
        passThreshold: 0.65,
        rejectThreshold: 0.25,
        structuredToolUsed: true,
        structuredTerminal: "reject",
      }),
    ).toBe("rejected")
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

describe("forcedCloseStatusFromScores", () => {
  const baseScores = {
    specificity: 0.7,
    authenticity: 0.7,
    cultural_depth: 0.7,
    overall: 0.5,
  }

  it("passes completed evidence at or above the pass threshold", () => {
    expect(
      forcedCloseStatusFromScores({
        scores: { ...baseScores, overall: 0.83 },
        passThreshold: 0.65,
        rejectThreshold: 0.25,
      }),
    ).toBe("passed")
  })

  it("redirects uncertain evidence between the thresholds", () => {
    expect(
      forcedCloseStatusFromScores({
        scores: { ...baseScores, overall: 0.5 },
        passThreshold: 0.65,
        rejectThreshold: 0.25,
      }),
    ).toBe("redirected")
  })

  it("rejects evidence at or below the reject threshold", () => {
    expect(
      forcedCloseStatusFromScores({
        scores: { ...baseScores, overall: 0.2 },
        passThreshold: 0.65,
        rejectThreshold: 0.25,
      }),
    ).toBe("rejected")
  })

  it("maps persisted terminal metadata to the derived status", () => {
    expect(terminalFieldForSessionStatus("passed")).toBe("pass")
    expect(terminalFieldForSessionStatus("redirected")).toBe("redirect")
    expect(terminalFieldForSessionStatus("rejected")).toBe("reject")
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
