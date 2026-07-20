import type { GrouchoInteractionUi, SessionOutcome } from "../client.js"

export type DecisionPhase = "none" | "evaluating" | "decision" | "revealed"

export const DEFAULT_EVALUATING_LABEL = "Groucho is considering…"

export const DEFAULT_EVALUATING_DURATION_MS = 1400
export const DEFAULT_DECISION_DURATION_MS = 900

export function isTerminalOutcome(status: SessionOutcome): boolean {
  return status === "passed" || status === "redirected" || status === "rejected"
}

export function presenceForDecisionPhase(input: {
  loading: boolean
  bootstrapping: boolean
  decisionPhase: DecisionPhase
  turnVisualState: GrouchoInteractionUi["visualState"]
}): GrouchoInteractionUi["visualState"] {
  if (input.loading || input.bootstrapping) return "thinking"
  if (input.decisionPhase === "evaluating") return "evaluating"
  if (input.decisionPhase === "decision") return "decision"
  return input.turnVisualState
}

export function shouldShowQuestion(input: {
  decisionPhase: DecisionPhase
  terminal: boolean
  hasTurn: boolean
}): boolean {
  if (!input.hasTurn) return false
  if (!input.terminal) return true
  return input.decisionPhase === "revealed"
}

export function shouldShowEvaluatingLabel(decisionPhase: DecisionPhase): boolean {
  return decisionPhase === "evaluating"
}

export function shouldShowInteractionInput(input: {
  terminal: boolean
  bootstrapping: boolean
  loading: boolean
  decisionPhase: DecisionPhase
  hasTurn: boolean
}): boolean {
  if (input.bootstrapping || input.loading) return false
  if (!input.hasTurn || input.terminal) return false
  return input.decisionPhase === "none"
}
