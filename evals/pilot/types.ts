import type { SignalProjectConversationConfig } from "@/lib/project-conversation-config"
import type { SignalEvidenceMap, SignalEvidenceStatus } from "@/lib/project-conversation-evidence"
import type { SignalTurn } from "@/lib/project-conversation-progress"
import type { WorkingMemory } from "@/lib/project-conversation-memory"

/** A saved project configuration, written by `pnpm pilot:pull`. */
export type PilotFlow = {
  slug: string
  name: string
  organisationId: string
  projectId: string
  pulledAt: string
  config: SignalProjectConversationConfig
  /** "open" runs the open conversation variant of the engine on the same configuration. */
  variant?: "open"
}

export type ScenarioEvent = {
  /** One-based applicant answer number this message replaces. */
  atAnswer: number
  say: string
  kind: "correction" | "question" | "stop" | "decline_topic" | "injection" | "ignore"
  /** Case-insensitive patterns checked against Groucho's reply to this message. */
  replyMustNotMatch?: string[]
  replyMustMatch?: string[]
}

/**
 * A scripted applicant. The applicant side is fixed so that differences between repeats come
 * from Groucho. Answers are keyed by signal name; the harness gives the answer for whichever
 * signal Groucho's question targets, so a script still responds to what was asked.
 */
export type Scenario = {
  id: string
  description: string
  /** How the applicant behaves when a model plays them. Defaults by scenario id. */
  character?: string
  opening: string
  answers: Record<string, string[]>
  /** Used when a question targets no signal, or that signal's answers are used up. */
  fallback: string[]
  events?: ScenarioEvent[]
  /** Same substance as another scenario in different wording; final signal states are compared. */
  twinOf?: string
  expect?: {
    /** Final status of a signal must be one of these. Keyed by signal name. */
    signals?: Record<string, SignalEvidenceStatus[]>
    maxAnswers?: number
  }
}

export type ModelCall = { operation: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; endedAt?: number; costUsd: number | null }

export type PilotTurn = {
  answerNumber: number
  answer: string
  answerSource: string
  reply: string
  status: "active" | "completed"
  signalTurn?: SignalTurn
  signalEvidence?: SignalEvidenceMap
  /** Open threads and the record of questions asked, as stored after this turn. */
  workingMemory?: WorkingMemory
  latencyMs: number
  /** Time until the first streamed reply text, when the reply streamed. */
  firstTextMs?: number
  /** When the reply model finished: what a saved open-style session's applicant waits for, since its evidence is saved afterwards. */
  replyReadyMs?: number
  calls: ModelCall[]
  retries: number
  model?: string
}

export type PilotRun = {
  flow: string
  scenario: string
  repeat: number
  opening: string
  turns: PilotTurn[]
  ended: "completed" | "answer_cap" | "error"
  /** Cost of the model playing the applicant, kept apart from Groucho's own calls. */
  applicantCostUsd?: number
  error?: string
}

export type CheckResult = { check: string; hard: boolean; pass: boolean; detail?: string }
