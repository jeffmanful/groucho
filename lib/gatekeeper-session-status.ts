import type { GatekeeperTerminalField } from "@/lib/gatekeeper-structured-tool"
import { canonicalTerminalDecision } from "@/lib/terminal-decision-prompt"
import type { Score } from "@/lib/scoring"

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
}): "passed" | "redirected" | "rejected" | null {
  const {
    assistantContent,
    scores,
    passThreshold,
    rejectThreshold,
    structuredTerminal = null,
    structuredToolUsed = false,
  } = opts

  if (structuredToolUsed && structuredTerminal !== null) {
    if (structuredTerminal === "pass") {
      return scores.overall >= passThreshold ? "passed" : "redirected"
    }
    if (structuredTerminal === "redirect") return "redirected"
    if (structuredTerminal === "reject") {
      return scores.overall <= rejectThreshold ? "rejected" : "redirected"
    }
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
