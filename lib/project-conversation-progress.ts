import type { ProjectConversationSignal } from "@/lib/project-conversation-config"
import type { SignalEvidenceMap, SignalEvidenceStatus } from "@/lib/project-conversation-evidence"
import type { AnswerRelation, SelfCheckKind } from "@/lib/project-conversation-memory"

export const MAX_SIGNAL_FOLLOW_UPS = 2
export const SETTLED_SIGNAL_STATUSES: readonly SignalEvidenceStatus[] = ["evidence_found", "none_identified", "declined"]
export const NO_SIGNAL_TARGET = "none"
/** Questions per signal: ideally one connected question, then at most one plainer retry. */
export const MAX_SIGNAL_ATTEMPTS = 2
export const SIGNAL_PROGRESSION = `Signals are the background purpose of this conversation. They keep your questions relevant; they are not a list to work through and they do not set the order. Use signal evidence from the current answer before deciding what to ask next.
Choose the next question like this. First look at what the applicant has actually said: the current answer and the open threads. Find something there that, if they said more about it, would help understand a signal that is still open or only partly understood, and ask about that in their terms. For example, if someone says they have had a record on all week and an open signal is about how music lives in their life, ask what it is about that record for them, not a fresh question about their listening habits. That is a connected question: set buildsOnQuote to the exact words of theirs it starts from. A detail attached to an unrelated signal question to make it sound connected is not a connection; if their words would not genuinely lead there, ask something else.
Ask about the applicant, not about other people in their life. Do not ask who they shared something with, who heard it, who was involved or who they helped, unless they have brought those people up themselves; ask what it means to them or what they get from it instead.
Only when nothing they have said leads towards an open signal, ask about that signal plainly and leave buildsOnQuote empty. Plain questions suit basic facts and the landing phase.
A question should have one clear purpose. Once an answer meets a signal's evidence criteria, leave that signal. Each signal gets at most ${MAX_SIGNAL_ATTEMPTS} questions across the conversation: ideally one connected question, then at most one plainer retry later, only if they passed over the first or it left the signal partly understood. When a question is passed over, take what they did share and do not repeat or reword it on the next turn. Accept short, modest answers and leave gaps open. Move on sooner when the applicant is uncomfortable, has declined or has said nothing applies.
The aim is to have asked well, not to obtain an answer. A signal that has been fairly asked about is done even if nothing came back. Respect the project's pacing, the applicant's questions and requests to stop. When every signal has evidence or has been fairly asked about, close naturally.
Set questionSignalId to the configured signal the visible question would help understand. Use "none" for a genuine warm-up, a clarification of your wording, a response to the applicant that does not seek signal evidence, or a closing. Never use "none" to continue probing a settled or exhausted topic.`

export type SignalTurn = {
  questionSignalId: string | null
  followUp: boolean
  changes: { signalId: string; status: SignalEvidenceStatus; summary: string }[]
  /** The applicant's words this question started from. Absent for a plain question. */
  buildsOn?: string
  /** How the applicant's answer on this turn related to the previous question. */
  answerRelation?: AnswerRelation
  /** The steering note the engine gave itself on this turn, if any. */
  selfCheck?: SelfCheckKind
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
    // A plain "no" settles the question as firmly as a refusal; neither invites another attempt.
    const canAsk = signal.explore && !SETTLED_SIGNAL_STATUSES.includes(status) && followUps < MAX_SIGNAL_FOLLOW_UPS && asked < MAX_SIGNAL_ATTEMPTS
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
