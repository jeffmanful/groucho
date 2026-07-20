import { describe, expect, it } from "vitest"
import {
  isTerminalOutcome,
  presenceForDecisionPhase,
  shouldShowEvaluatingLabel,
  shouldShowInteractionInput,
  shouldShowQuestion,
} from "../react/decision-moment.js"

describe("decision-moment", () => {
  it("detects terminal outcomes", () => {
    expect(isTerminalOutcome("passed")).toBe(true)
    expect(isTerminalOutcome("redirected")).toBe(true)
    expect(isTerminalOutcome("rejected")).toBe(true)
    expect(isTerminalOutcome("active")).toBe(false)
  })

  it("maps decision phases to presence states", () => {
    expect(
      presenceForDecisionPhase({
        loading: false,
        bootstrapping: false,
        decisionPhase: "evaluating",
        turnVisualState: "curious",
      }),
    ).toBe("evaluating")
    expect(
      presenceForDecisionPhase({
        loading: false,
        bootstrapping: false,
        decisionPhase: "decision",
        turnVisualState: "curious",
      }),
    ).toBe("decision")
    expect(
      presenceForDecisionPhase({
        loading: true,
        bootstrapping: false,
        decisionPhase: "none",
        turnVisualState: "curious",
      }),
    ).toBe("thinking")
  })

  it("hides terminal copy until reveal", () => {
    expect(
      shouldShowQuestion({ decisionPhase: "evaluating", terminal: true, hasTurn: true }),
    ).toBe(false)
    expect(
      shouldShowQuestion({ decisionPhase: "revealed", terminal: true, hasTurn: true }),
    ).toBe(true)
    expect(
      shouldShowQuestion({ decisionPhase: "none", terminal: false, hasTurn: true }),
    ).toBe(true)
  })

  it("shows evaluating label only during evaluating phase", () => {
    expect(shouldShowEvaluatingLabel("evaluating")).toBe(true)
    expect(shouldShowEvaluatingLabel("decision")).toBe(false)
  })

  it("hides interaction input during decision sequence", () => {
    expect(
      shouldShowInteractionInput({
        terminal: false,
        bootstrapping: false,
        loading: false,
        decisionPhase: "none",
        hasTurn: true,
      }),
    ).toBe(true)
    expect(
      shouldShowInteractionInput({
        terminal: true,
        bootstrapping: false,
        loading: false,
        decisionPhase: "evaluating",
        hasTurn: true,
      }),
    ).toBe(false)
  })
})
