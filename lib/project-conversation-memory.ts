import type { ProjectConversationSignal } from "@/lib/project-conversation-config"

/** How an applicant's answer related to the question Groucho had just asked. */
export const ANSWER_RELATIONS = ["answered", "partly_answered", "passed_over", "declined", "nothing_to_share", "no_question"] as const
export type AnswerRelation = typeof ANSWER_RELATIONS[number]

export const THREAD_RELEVANCE = ["high", "medium", "low"] as const
export type ThreadRelevance = typeof THREAD_RELEVANCE[number]
const isRelevance = (value: unknown): value is ThreadRelevance => THREAD_RELEVANCE.includes(value as ThreadRelevance)

/** Something the applicant mentioned, in their words, that a later question could build on. */
export type ConversationThread = {
  /** Stable within the conversation: t1, t2, ... in the order the applicant raised them. */
  id: string
  detail: string
  quote: string
  /** One-based applicant answer the quote comes from. */
  turn: number
  /** Signals this thread could help understand if the applicant said more. */
  signalIds: string[]
  /** How much this matters to the project's purpose, judged once when the thread is noticed. */
  relevance?: ThreadRelevance
  /** Why it might matter later: the connection to the project that would make it worth raising. */
  whyItMatters?: string
  /** The answer number after which a question first built on this thread. */
  followedAt?: number
  /** How many questions have built on this thread. */
  asks?: number
  /** The answer number at which the conversation had covered this thread well enough to move on. */
  finishedAt?: number
}

/** A question Groucho asked towards a signal, and what came back. */
export type SignalAttempt = {
  signalId: string
  /** The answer number this question followed. */
  turn: number
  question: string
  /** The applicant's words the question started from. Absent for a plain question. */
  buildsOn?: string
  outcome?: AnswerRelation
}

/**
 * What Groucho carries between turns besides signal evidence: open threads to build on and a
 * record of what it asked. Groucho controls whether it asked well, not what comes back, so the
 * attempt record is what shows a signal was fairly tried.
 */
export type WorkingMemory = {
  threads: ConversationThread[]
  attempts: SignalAttempt[]
  relations: { turn: number; relation: AnswerRelation }[]
  /** The thread the most recent question was about. */
  currentThreadId?: string
  /** Open conversation only: the answer at which the remaining areas were first shown to the host. */
  areasShownAt?: number
}

const MAX_THREADS = 12
const MAX_THREADS_PER_ANSWER = 3
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const isRelation = (value: unknown): value is AnswerRelation => ANSWER_RELATIONS.includes(value as AnswerRelation)
const contains = (text: string, quote: string) => text.toLowerCase().includes(quote.toLowerCase())

export function emptyWorkingMemory(): WorkingMemory {
  return { threads: [], attempts: [], relations: [] }
}

export function readWorkingMemory(raw: unknown): WorkingMemory {
  const value = record(raw)
  const list = (items: unknown) => Array.isArray(items) ? items.map(record) : []
  return {
    threads: list(value.threads).flatMap((item, index) => typeof item.detail === "string" && typeof item.quote === "string" && Number.isInteger(item.turn)
      ? [{ id: typeof item.id === "string" ? item.id : `t${index + 1}`, detail: item.detail, quote: item.quote, turn: item.turn as number,
        signalIds: Array.isArray(item.signalIds) ? item.signalIds.filter((id): id is string => typeof id === "string") : [],
        ...(Number.isInteger(item.followedAt) ? { followedAt: item.followedAt as number } : {}),
        ...(Number.isInteger(item.asks) ? { asks: item.asks as number } : {}),
        ...(Number.isInteger(item.finishedAt) ? { finishedAt: item.finishedAt as number } : {}),
        ...(isRelevance(item.relevance) ? { relevance: item.relevance } : {}),
        ...(typeof item.whyItMatters === "string" && item.whyItMatters ? { whyItMatters: item.whyItMatters } : {}) }] : []),
    attempts: list(value.attempts).flatMap(item => typeof item.signalId === "string" && typeof item.question === "string" && Number.isInteger(item.turn)
      ? [{ signalId: item.signalId, turn: item.turn as number, question: item.question,
        ...(typeof item.buildsOn === "string" && item.buildsOn ? { buildsOn: item.buildsOn } : {}),
        ...(isRelation(item.outcome) ? { outcome: item.outcome } : {}) }] : []),
    relations: list(value.relations).flatMap(item => Number.isInteger(item.turn) && isRelation(item.relation) ? [{ turn: item.turn as number, relation: item.relation }] : []),
    ...(typeof value.currentThreadId === "string" ? { currentThreadId: value.currentThreadId } : {}),
    ...(Number.isInteger(value.areasShownAt) ? { areasShownAt: value.areasShownAt as number } : {}),
  }
}

/** The applicant's own words a question starts from, or undefined when the quote is not theirs. */
export function groundedQuote(quote: unknown, answers: readonly string[]): string | undefined {
  if (typeof quote !== "string") return undefined
  const trimmed = quote.trim()
  return trimmed.length >= 3 && trimmed.length <= 400 && answers.some(answer => contains(answer, trimmed)) ? trimmed : undefined
}

/**
 * Record what the current answer did: how it related to the last question, and any new threads.
 * Threads need an exact quote from this answer, like signal evidence.
 */
export function recordAnswer(memory: WorkingMemory, input: { relation: unknown; threads: unknown; finishedThreadIds?: unknown; answer: string; turn: number; signals: readonly ProjectConversationSignal[] }): WorkingMemory {
  const relation = isRelation(input.relation) ? input.relation : undefined
  const attempts = memory.attempts.map((attempt, index) =>
    relation && relation !== "no_question" && index === memory.attempts.length - 1 && attempt.turn === input.turn - 1 && !attempt.outcome ? { ...attempt, outcome: relation } : attempt)
  const signalIds = new Set(input.signals.map(signal => signal.id))
  const fresh = (Array.isArray(input.threads) ? input.threads.map(record) : []).flatMap(item => {
    const quote = typeof item.quote === "string" ? item.quote.trim() : ""
    const detail = typeof item.detail === "string" ? item.detail.trim() : ""
    if (!quote || !detail || detail.length > 300 || quote.length > 400 || !input.answer.includes(quote)) return []
    if (memory.threads.some(thread => contains(thread.quote, quote) || contains(quote, thread.quote))) return []
    const related = Array.isArray(item.relatedSignalIds) ? item.relatedSignalIds.filter((id): id is string => typeof id === "string" && signalIds.has(id)) : []
    const why = typeof item.whyItMatters === "string" ? item.whyItMatters.trim().slice(0, 300) : ""
    return [{ detail, quote, turn: input.turn, signalIds: related, ...(isRelevance(item.relevance) ? { relevance: item.relevance } : {}), ...(why ? { whyItMatters: why } : {}) }]
  }).slice(0, MAX_THREADS_PER_ANSWER)
    // Keep the applicant's order, so the first thing they said is the first thing to come back to.
    .sort((a, b) => input.answer.indexOf(a.quote) - input.answer.indexOf(b.quote))
  const nextNumber = Math.max(0, ...memory.threads.map(thread => Number(thread.id.slice(1)) || 0)) + 1
  const finished = new Set(Array.isArray(input.finishedThreadIds) ? input.finishedThreadIds.filter((id): id is string => typeof id === "string") : [])
  // A thread is talked through only after Groucho has asked about it; one merely mentioned stays held.
  const threads = [...memory.threads.map(thread => finished.has(thread.id) && !thread.finishedAt && (thread.asks ?? 0) > 0 ? { ...thread, finishedAt: input.turn } : thread),
    ...fresh.map((thread, index) => ({ id: `t${nextNumber + index}`, ...thread }))]
  return {
    ...memory,
    threads: threads.slice(-MAX_THREADS), attempts,
    relations: relation ? [...memory.relations, { turn: input.turn, relation }] : memory.relations,
  }
}

/**
 * Record the question Groucho is about to show. The thread it builds on becomes the current one;
 * a question towards a signal is also kept as an attempt.
 */
export function recordQuestion(memory: WorkingMemory, input: { signalId?: string; question: string; buildsOn?: string; turn: number }): WorkingMemory {
  const { buildsOn } = input
  const thread = buildsOn ? [...memory.threads].reverse().find(item => contains(item.quote, buildsOn) || contains(buildsOn, item.quote)) : undefined
  return {
    ...memory,
    threads: memory.threads.map(item => item.id === thread?.id ? { ...item, followedAt: item.followedAt ?? input.turn, asks: (item.asks ?? 0) + 1 } : item),
    currentThreadId: thread?.id,
    attempts: input.signalId ? [...memory.attempts, { signalId: input.signalId, turn: input.turn, question: input.question.slice(0, 500), ...(buildsOn ? { buildsOn } : {}) }] : memory.attempts,
  }
}

/** A thread asked about twice without being finished has had its chance; the applicant moved on. */
const MAX_THREAD_ASKS = 2
const settledThread = (thread: ConversationThread) => Boolean(thread.finishedAt) || (thread.asks ?? 0) >= MAX_THREAD_ASKS

const RANK: Record<ThreadRelevance, number> = { high: 0, medium: 1, low: 2 }

/**
 * Where the conversation stands, worked out in code so it is the same every run: stay with the
 * current thread until it is talked through. Other threads are held, most relevant first; they
 * are raised when the conversation reaches something they connect to, not in turn.
 */
export function threadPlan(memory: WorkingMemory): { current?: ConversationThread; stay: boolean; held: ConversationThread[] } {
  const current = memory.threads.find(thread => thread.id === memory.currentThreadId)
  const stay = Boolean(current && !settledThread(current))
  const held = memory.threads.filter(thread => thread.id !== current?.id && !settledThread(thread))
    .sort((a, b) => RANK[a.relevance ?? "medium"] - RANK[b.relevance ?? "medium"] || a.turn - b.turn)
  return { current, stay, held }
}

export type ConversationPhase = "opening" | "middle" | "landing"

/** A light arc. Landing begins when the remaining answers are only enough for the signals not yet tried. */
export function conversationPhase(turnCount: number, maxAnswers: number | undefined, untried: number): ConversationPhase {
  if (turnCount <= 1) return "opening"
  if (maxAnswers !== undefined && maxAnswers - turnCount <= Math.max(2, untried)) return "landing"
  return "middle"
}

/** The compact view the model sees. Signal names, never IDs alone, so the link is readable. */
export function workingMemoryForPrompt(memory: WorkingMemory, signals: readonly ProjectConversationSignal[]) {
  const name = (id: string) => signals.find(signal => signal.id === id)?.name ?? id
  return {
    openThreads: memory.threads.filter(thread => !thread.followedAt).map(thread => ({ said: thread.quote, about: thread.detail, couldHelpUnderstand: thread.signalIds.map(name) })),
    questionsAsked: memory.attempts.map(attempt => ({ signalId: attempt.signalId, signal: name(attempt.signalId), question: attempt.question,
      connected: Boolean(attempt.buildsOn), outcome: attempt.outcome ?? "awaiting_answer" })),
  }
}

export const PHASE_GUIDANCE: Record<ConversationPhase, string> = {
  opening: "Keep it easy and follow what they bring.",
  middle: "Follow their threads towards signals that are open or partly understood.",
  landing: "Few answers remain. Ask plainly about any signal not yet asked about, one per turn, then close.",
}

/** Added to the evidence review, which already reads every answer beside the reply. */
export const WORKING_MEMORY_REVIEW = `Also return two things about the current answer.
answerRelation: how it relates to the host's most recent question. answered: it addresses what was asked. partly_answered: it addresses part of it or stays vague. passed_over: it talks about something else or gives a filler reply that does not address the question. declined: they chose not to answer it. nothing_to_share: they addressed it and said nothing applies or comes to mind. no_question: the host's last message asked nothing.
threads: up to three specific things the applicant mentions in the current answer that the host could build a later question on, such as an activity, a person, a place, a piece of work or a habit. Include things said in reply to the host's question when there is more to learn about them: an answer that names two things has two threads. Give each a short neutral detail, an exact quote copied from the current answer, relatedSignalIds for the signals it could help understand if they said more (empty if none), relevance (high, medium or low: how much talking about it would show who this person is in relation to the project's purpose; what they do for or with other people usually matters more than what they consume) and whyItMatters (one short clause on the connection to the project that would make it worth raising, as in "could connect to giving and taking feedback"). Leave out anything already fully explained, other people's experiences, and filler. Return an empty list when there is nothing.
finishedThreadIds: ids from the thread list below that the host has asked about and that are now talked through: the applicant has said what it means to them or why they do it, or has made clear there is nothing more to say. A factual or logistical answer (when, where, how long) does not talk a thread through.
A reply that nothing applies, or a refusal, answers the question that was asked. Record none_identified or declined only for the signal that question was about, never for a different signal.`

export type SelfCheckKind = "passed_over" | "rein_in" | "repeating" | "pivot" | "stalling"
/** One steering note for the turn. allowBridge lets a strict reply style open with a short linking clause. */
export type SelfCheck = { kind: SelfCheckKind; note: string; allowBridge: boolean }

export const BRIDGE_ALLOWANCE = "On this turn the question sentence may begin with one short clause that acknowledges what they just shared or marks the change of subject, for example “Leaving the film for a moment, where are you based?”. Keep it to a few words, with no praise and no summary."

type CheckedSignal = { id: string; name: string; canAsk: boolean; asked: number }
const overlaps = (a?: string, b?: string) => Boolean(a && b && (contains(a, b) || contains(b, a)))

/**
 * Groucho's reading of its own conversation, worked out in code so it is the same on every run.
 * Returns the single most pressing note, or nothing when the conversation needs no steering.
 * Before the evidence review finishes, the current answer's relation is unknown and the
 * passed-over check simply does not fire; the reply reviewer runs it again with that known.
 */
export function conversationSelfCheck(input: {
  memory: WorkingMemory
  progress: readonly CheckedSignal[]
  /** Applicant answers so far, including the current one. */
  turnCount: number
  maxAnswers?: number
  /** Most recent consecutive turns in which no signal evidence changed. */
  quietTurns: number
}): SelfCheck | undefined {
  const { memory, progress, turnCount } = input
  const name = (id: string) => progress.find(signal => signal.id === id)?.name ?? "that area"
  const open = progress.filter(signal => signal.canAsk)
  const untried = open.filter(signal => signal.asked === 0)
  const others = (except?: string) => open.filter(signal => signal.id !== except).map(signal => signal.name)
  const last = memory.attempts.at(-1)
  const previous = memory.attempts.at(-2)
  const relation = memory.relations.find(item => item.turn === turnCount)?.relation
  const earlier = memory.relations.find(item => item.turn === turnCount - 1)?.relation

  if (relation === "passed_over") {
    return earlier === "passed_over"
      ? { kind: "passed_over", allowBridge: true, note: "The applicant has passed over two questions in a row. Stop steering for a moment: ask one easy, concrete question about what they have just been talking about, or close if nothing useful remains." }
      : { kind: "passed_over", allowBridge: true, note: `The applicant did not answer your last question${last?.turn === turnCount - 1 ? ` about ${name(last.signalId)}` : ""} and talked about something else. Work with what they did share. Do not repeat or reword that question now.` }
  }
  const remaining = input.maxAnswers === undefined ? undefined : input.maxAnswers - turnCount
  if (remaining !== undefined && untried.length && remaining <= untried.length + 1) {
    return { kind: "rein_in", allowBridge: true, note: `Only ${remaining} answer${remaining === 1 ? "" : "s"} remain and these areas have not been asked about: ${untried.map(signal => signal.name).join(", ")}. Leave the current subject and ask about one of them now, plainly if nothing they said leads there.` }
  }
  if (last && previous && last.turn === previous.turn + 1 && last.signalId === previous.signalId) {
    const disengaged = last.outcome === "passed_over" || last.outcome === "declined" || last.outcome === "nothing_to_share"
    const next = others(last.signalId)
    return disengaged
      ? { kind: "repeating", allowBridge: false, note: `You have asked about ${name(last.signalId)} twice running without getting further. Leave it there.${next.length ? ` Still open: ${next.join(", ")}.` : " Close if nothing useful remains."}` }
      : { kind: "pivot", allowBridge: true, note: `You have spent two questions on ${name(last.signalId)}, which is its fair share however well it is going.${next.length ? ` Move to a different area: ${next.join(", ")}.` : " Close if nothing useful remains."}` }
  }
  if (last?.buildsOn && memory.attempts.filter(attempt => overlaps(attempt.buildsOn, last.buildsOn)).length >= 2) {
    return { kind: "repeating", allowBridge: false, note: `You have already built two questions on “${last.buildsOn}”. Build the next one on something else they said, or ask plainly.` }
  }
  if (input.quietTurns >= 2) {
    return { kind: "stalling", allowBridge: false, note: `Nothing new has been learned in the last ${input.quietTurns} turns. Try a different thread or a different area${open.length ? ` (${open.map(signal => signal.name).join(", ")})` : ""}, or close if nothing useful remains.` }
  }
  return undefined
}

/** Areas the author lets Groucho ask about that the conversation has not yet settled. */
export function unexploredAreas(signals: readonly ProjectConversationSignal[], evidence: Record<string, { status: string } | undefined>) {
  return signals.filter(signal => signal.explore && ["not_explored", "partly_understood"].includes(evidence[signal.id]?.status ?? "not_explored"))
}

/**
 * When the open conversation shows the host the areas the project still hopes to understand.
 * Until then the host only sees the purpose, so signals cannot bend its questions. Once shown,
 * they stay shown so that closing is an informed choice.
 */
export function shouldShowAreas(input: { memory: WorkingMemory; unexplored: number; turnCount: number; maxAnswers?: number }): boolean {
  if (!input.unexplored) return false
  if (input.memory.areasShownAt !== undefined) return true
  const remaining = input.maxAnswers === undefined ? Infinity : input.maxAnswers - input.turnCount
  // The last third of the conversation, so a short limit does not bring the areas in from the start.
  const lastStretch = input.maxAnswers !== undefined && remaining <= Math.max(2, Math.ceil(input.maxAnswers / 3))
  // A natural point to change subject: everything relevant they have raised has been talked through.
  const plan = threadPlan(input.memory)
  const nothingOpen = input.turnCount >= 3 && input.memory.threads.length > 0 && !plan.stay && !plan.held.some(thread => thread.relevance !== "low")
  return lastStretch || nothingOpen
}

export function openAreasNote(areas: readonly ProjectConversationSignal[]): string {
  return `AREAS NOT YET COVERED
The project also hopes to understand these, and they have not come up: ${JSON.stringify(areas.map(area => ({ id: area.id, area: area.name, hopingToUnderstand: area.understanding })))}
Once anything in their latest answer has been talked through, you may ask about one of these, one per turn. Just ask; do not announce a change of subject. If something they said genuinely leads there, start from it instead. Set questionSignalId to the area's id when you do. You do not have to ask about every one, and you may close when the rest would not add anything.`
}

/**
 * The host's notes for the open conversation: what they have said in order and where each thing
 * stands, which thread to be on, and the room left. Facts for the model to use, not rules.
 */
export function openConversationState(input: {
  signals: readonly ProjectConversationSignal[]
  evidence: Record<string, { status: string; summary: string }>
  memory: WorkingMemory
  turnCount: number
  maxAnswers?: number
  showAreas: boolean
}): string {
  const plan = threadPlan(input.memory)
  const where = plan.stay && plan.current
    ? `You are in the middle of "${plan.current.quote}" (${plan.current.id}). Stay with it until you understand what it says about them, unless they have clearly moved on.`
    : `${plan.current ? `"${plan.current.quote}" is talked through. ` : ""}Choose where to go: the most relevant thing in their latest answer, or a held thread if the conversation has reached something it connects to.`
  const held = plan.held.map(thread => ({ id: thread.id, said: thread.quote, relevance: thread.relevance ?? "medium", ...(thread.whyItMatters ? { whyItMightMatter: thread.whyItMatters } : {}), ...(thread.asks ? { askedOnceNotAnswered: true } : {}) }))
  const remaining = input.maxAnswers === undefined ? undefined : input.maxAnswers - input.turnCount
  const areas = unexploredAreas(input.signals, input.evidence)
  return `\n\nYOUR NOTES ON THIS CONVERSATION
${where}
Held threads, most relevant first (their latest answer is not in this list yet; read it in the transcript): ${JSON.stringify(held)}
Talked through: ${JSON.stringify(input.memory.threads.filter(thread => thread.finishedAt).map(thread => thread.quote))}
This is answer ${input.turnCount}${remaining === undefined ? "" : ` of at most ${input.maxAnswers}; ${remaining} remain after it`}.
${input.showAreas && areas.length ? openAreasNote(areas) : areas.length ? "There are other areas the project hopes to understand. You will be shown any that have not come up when it is time to change subject. Until then, do not close unless they want to stop." : "The areas the project hopes to understand have all come up."}`
}
