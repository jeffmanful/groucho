import type { GatekeeperTerminalField } from "@/lib/gatekeeper-structured-tool"
import { canonicalTerminalDecision } from "@/lib/terminal-decision-prompt"
import type { Score } from "@/lib/scoring"

export type GatekeeperSessionStatus = "passed" | "redirected" | "rejected"

export function forcedCloseStatusFromScores(input: {
  scores: Score
  passThreshold: number
  rejectThreshold: number
}): GatekeeperSessionStatus {
  if (input.scores.overall >= input.passThreshold) return "passed"
  if (input.scores.overall <= input.rejectThreshold) return "rejected"
  return "redirected"
}

export function terminalFieldForSessionStatus(
  status: GatekeeperSessionStatus,
): Exclude<GatekeeperTerminalField, "none"> {
  if (status === "passed") return "pass"
  if (status === "rejected") return "reject"
  return "redirect"
}

export function parseAssistantStructuredMeta(meta: unknown): {
  terminal: GatekeeperTerminalField | null
  toolUsed: boolean
} {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return { terminal: null, toolUsed: false }
  }
  const m = meta as Record<string, unknown>
  if (
    m.gatekeeper_structured === true &&
    typeof m.gatekeeper_terminal === "string"
  ) {
    const t = m.gatekeeper_terminal
    if (t === "none" || t === "pass" || t === "redirect" || t === "reject") {
      return { terminal: t, toolUsed: true }
    }
  }
  return { terminal: null, toolUsed: false }
}

/**
 * Same terminal rules as `post-session-message`: structured `terminal` when the
 * tool was used, otherwise legacy string detection on `assistantContent`.
 */
export function computeTerminalStatusFromGatekeeperTurn(opts: {
  assistantContent: string
  scores: Score
  passThreshold: number
  rejectThreshold: number
  structuredTerminal?: GatekeeperTerminalField | null
  structuredToolUsed?: boolean
}): GatekeeperSessionStatus | null {
  const {
    assistantContent,
    scores,
    passThreshold,
    rejectThreshold,
    structuredTerminal = null,
    structuredToolUsed = false,
  } = opts

  if (structuredToolUsed && structuredTerminal !== null) {
    if (structuredTerminal === "pass") return "passed"
    if (structuredTerminal === "redirect") return "redirected"
    if (structuredTerminal === "reject") return "rejected"
    return null
  }

  const decision = canonicalTerminalDecision(assistantContent)
  if (decision === "Yeah. Here.") {
    return scores.overall >= passThreshold ? "passed" : "redirected"
  }
  if (decision === "REDIRECT") return "redirected"
  if (decision === "REJECTED") {
    return scores.overall <= rejectThreshold ? "rejected" : "redirected"
  }
  return null
}
