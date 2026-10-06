import { describe, expect, it } from "vitest"
import {
  canonicalTerminalDecision,
  STRUCTURED_SESSION_OUTCOME_MARKER,
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

  it("does not duplicate when the structured marker is already present", () => {
    const base = `Custom persona.\n\n---\n\n${STRUCTURED_SESSION_OUTCOME_MARKER}\n\nBody`
    const out = withTerminalDecisionAppendix(base)
    expect(out).toBe(base.trim())
  })
})

describe("canonicalTerminalDecision", () => {
  it("does not treat split words across lines as pass", () => {
    expect(canonicalTerminalDecision("Yeah.\nHere.")).toBe(null)
  })

  it("prefers the last line when several lines could match", () => {
    expect(canonicalTerminalDecision("Yeah. Here.\nREJECTED")).toBe("REJECTED")
  })
})
