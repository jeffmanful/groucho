import { describe, expect, it } from "vitest"
import {
  canonicalTerminalDecision,
  STRUCTURED_SESSION_OUTCOME_MARKER,
  TERMINAL_DECISION_MARKER,
  TERMINAL_DECISION_SYSTEM_APPENDIX,
  withTerminalDecisionAppendix,
} from "@/lib/terminal-decision-prompt"

describe("withTerminalDecisionAppendix", () => {
  it("appends the protocol when the marker is absent", () => {
    const base = "You are a concierge. Be brief."
    const out = withTerminalDecisionAppendix(base)
    expect(out.startsWith(base)).toBe(true)
    expect(out).toContain(TERMINAL_DECISION_SYSTEM_APPENDIX)
    expect(out).toContain(STRUCTURED_SESSION_OUTCOME_MARKER)
  })

  it("does not duplicate when the legacy marker is already present", () => {
    const base = `Role intro.\n\n${TERMINAL_DECISION_MARKER}\n`
    const out = withTerminalDecisionAppendix(base)
    expect(out).toBe(base.trim())
    const first = out.indexOf(TERMINAL_DECISION_MARKER)
    const last = out.lastIndexOf(TERMINAL_DECISION_MARKER)
    expect(first).toBe(last)
  })

  it("does not duplicate when the structured marker is already present", () => {
    const base = `Custom persona.\n\n---\n\n${STRUCTURED_SESSION_OUTCOME_MARKER}\n\nBody`
    const out = withTerminalDecisionAppendix(base)
    expect(out).toBe(base.trim())
  })

  it("returns only the appendix for empty input", () => {
    expect(withTerminalDecisionAppendix("   ")).toBe(
      TERMINAL_DECISION_SYSTEM_APPENDIX.trim(),
    )
  })
})

describe("canonicalTerminalDecision", () => {
  it("matches pass on a line after preamble", () => {
    expect(canonicalTerminalDecision("Alright.\n\nYeah. Here.")).toBe(
      "Yeah. Here.",
    )
  })

  it("matches redirect on second line", () => {
    expect(canonicalTerminalDecision("Ok.\nREDIRECT")).toBe("REDIRECT")
  })

  it("does not treat split words across lines as pass", () => {
    expect(canonicalTerminalDecision("Yeah.\nHere.")).toBe(null)
  })

  it("prefers the last line when several lines could match", () => {
    expect(canonicalTerminalDecision("Yeah. Here.\nREJECTED")).toBe("REJECTED")
  })
})
