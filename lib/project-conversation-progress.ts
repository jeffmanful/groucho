import type { ProjectConversationSignal } from "@/lib/project-conversation-config"
import type { SignalEvidenceMap, SignalEvidenceStatus } from "@/lib/project-conversation-evidence"

export const MAX_SIGNAL_FOLLOW_UPS = 2
export const NO_SIGNAL_TARGET = "none"
export const SIGNAL_PROGRESSION = `Use signal evidence from the current answer before deciding what to ask next. A question should have one clear purpose. Identify the signal it would help understand, even if the wording refers to an earlier topic. Once the answer meets a signal's evidence criteria, move to another relevant signal. For example, after someone says they shared an album with their radio co-hosts, ask about their role on the show or an example of helping someone rather than asking what happened to the album. An adjacent detail is useful only if it would specifically clarify a remaining signal. A relevant unasked question can open a signal. After that, use at most ${MAX_SIGNAL_FOLLOW_UPS} deeper attempts across the conversation and only if they ask for a distinct, useful detail. When an answer is uncertain, a fresh lower-pressure invitation is enough if it would genuinely help. Move on sooner when the applicant is uncomfortable, has declined or the thread has stopped yielding useful information. Accept short, modest answers and leave gaps open. Never repeat or reword a question to exhaust an allowance. Respect the project's pacing, the applicant's questions and requests to stop. If no relevant question remains, close naturally. Set questionSignalId to the configured signal the visible question would explore. Use "none" for a genuine warm-up, a clarification of your wording, a response to the applicant that does not seek signal evidence, or a closing. Never use "none" to continue probing a settled or exhausted topic.`

export type SignalTurn = {
  questionSignalId: string | null
  followUp: boolean
  changes: { signalId: string; status: SignalEvidenceStatus; summary: string }[]
}

type TrackedEntry = { role: string; content: string; metadata: Record<string, unknown> }

export function signalQuestionCounts(history: readonly TrackedEntry[], openingSignalId?: string) {
  const counts = new Map<string, { asked: number; followUps: number }>()
  if (openingSignalId) counts.set(openingSignalId, { asked: 1, followUps: 0 })
  for (const entry of history.slice(1)) {
    if (entry.role !== "assistant") continue
    const turn = entry.metadata.conversation_signal_turn as SignalTurn | undefined
    if (!turn?.questionSignalId) continue
    const count = counts.get(turn.questionSignalId) ?? { asked: 0, followUps: 0 }
    counts.set(turn.questionSignalId, { asked: count.asked + 1, followUps: count.followUps + Number(turn.followUp === true) })
  }
  return counts
}

export function projectSignalProgress(signals: readonly ProjectConversationSignal[], evidence: SignalEvidenceMap, counts: ReturnType<typeof signalQuestionCounts>) {
  return signals.map(signal => {
    const { asked, followUps } = counts.get(signal.id) ?? { asked: 0, followUps: 0 }
    const status = evidence[signal.id]?.status ?? "not_explored"
    const nextIsFollowUp = asked > 0 || status === "partly_understood"
    const canAsk = signal.explore && status !== "evidence_found" && status !== "declined" && followUps < MAX_SIGNAL_FOLLOW_UPS
    return { id: signal.id, name: signal.name, goal: signal.understanding, evidence: signal.evidence, explore: signal.explore, status, asked, followUps, nextIsFollowUp, canAsk }
  })
}

export type ProjectSignalProgress = ReturnType<typeof projectSignalProgress>

export function signalTargetBlocked(target: string | undefined, progress: ProjectSignalProgress) {
  return Boolean(target && target !== NO_SIGNAL_TARGET && !progress.some(signal => signal.id === target && signal.canAsk))
}

export function makeSignalTurn(target: string | undefined, progress: ProjectSignalProgress, evidence: SignalEvidenceMap, answer: number): SignalTurn {
  const question = progress.find(signal => signal.id === target && signal.canAsk)
  const changes = Object.entries(evidence)
    .filter(([, item]) => item.sources.some(source => source.turn === answer))
    .map(([signalId, item]) => ({
      signalId, status: item.status, summary: item.summary.length > 240 ? `${item.summary.slice(0, 239).trimEnd()}…` : item.summary,
    }))
  return { questionSignalId: question?.id ?? null, followUp: question?.nextIsFollowUp ?? false, changes }
}
