import { projectFinalMessage } from "@/lib/project-conversation-runtime"
import { MAX_SIGNAL_ATTEMPTS, SETTLED_SIGNAL_STATUSES } from "@/lib/project-conversation-progress"
import type { SignalEvidenceStatus } from "@/lib/project-conversation-evidence"
import type { CheckResult, PilotFlow, PilotRun, Scenario } from "@/evals/pilot/types"

/** The engine's own replies when a reply review fails. Seeing one means the turn fell back. */
const FALLBACK_REPLIES = ["You can add another detail or say you’re done.", "I couldn’t check that just now."]
const INTERNAL_TERMS = /\b(?:evidence_found|partly_understood|none_identified|not_explored|questionSignalId|signalEvidence|choiceKey|s_[0-9a-f]{32})\b/

const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim()
const questionOf = (reply: string) => reply.split(/(?<=[.!?])\s+/).filter(sentence => /[?？]$/.test(sentence.trim())).at(-1)?.trim()
const signalName = (flow: PilotFlow, id: string) => flow.config.signals.find(signal => signal.id === id)?.name ?? id
const signalId = (flow: PilotFlow, name: string) => flow.config.signals.find(signal => signal.name === name)?.id

export function finalStatuses(flow: PilotFlow, run: PilotRun): Record<string, SignalEvidenceStatus> {
  const evidence = run.turns.at(-1)?.signalEvidence ?? {}
  return Object.fromEntries(flow.config.signals.map(signal => [signal.name, evidence[signal.id]?.status ?? "not_explored"]))
}

/** The signals Groucho's questions targeted, in order. "-" is a question with no signal target. */
export function questionPath(flow: PilotFlow, run: PilotRun): string[] {
  return run.turns.filter(turn => turn.status === "active").map(turn => turn.signalTurn?.questionSignalId ? signalName(flow, turn.signalTurn.questionSignalId) : "-")
}

/** Checks that code can decide. Hard checks are contract violations; soft checks are worth reading. */
export function checkRun(flow: PilotFlow, scenario: Scenario, run: PilotRun): CheckResult[] {
  const { config } = flow
  const results: CheckResult[] = []
  const add = (check: string, hard: boolean, problems: string[]) => results.push({ check, hard, pass: problems.length === 0, ...(problems.length ? { detail: problems.join(" | ") } : {}) })
  const active = run.turns.filter(turn => turn.status === "active")
  const last = run.turns.at(-1)

  add("completed", true, run.ended === "completed" ? [] : [`ended: ${run.ended}${run.error ? ` (${run.error})` : ""}`])
  add("answer_ceiling", true, run.turns.length <= config.maxAnswers ? [] : [`${run.turns.length} answers, ceiling ${config.maxAnswers}`])
  add("no_retries", false, run.turns.filter(turn => turn.retries).map(turn => `answer ${turn.answerNumber}: ${turn.retries} retry`))

  const finalMessage = projectFinalMessage(config)
  add("final_message", true, run.ended !== "completed" || last?.reply.trim().endsWith(finalMessage) ? [] : [`closing reply does not end with the configured final message`])
  add("closing_has_no_question", true, run.ended === "completed" && last && /[?？]/.test(last.reply) ? [`closing reply asks a question`] : [])

  const stops = (scenario.events ?? []).filter(event => event.kind === "stop")
  add("stop_respected", true, stops.flatMap(event => {
    const turn = run.turns.find(candidate => candidate.answerNumber === event.atAnswer)
    if (!turn) return []
    return turn.status === "completed" && !/[?？]/.test(turn.reply) ? [] : [`answer ${event.atAnswer} asked to stop; reply was ${turn.status}`]
  }))

  add("quotes_grounded", true, Object.entries(last?.signalEvidence ?? {}).flatMap(([id, evidence]) => evidence.sources.flatMap(source => {
    const answer = run.turns.find(turn => turn.answerNumber === source.turn)?.answer
    return answer?.includes(source.quote) ? [] : [`${signalName(flow, id)}: quote not in answer ${source.turn}`]
  })))

  const asked = new Map<string, number>()
  const settledQuestions: string[] = []
  for (const turn of active) {
    const target = turn.signalTurn?.questionSignalId
    if (!target) continue
    asked.set(target, (asked.get(target) ?? 0) + 1)
    const status = turn.signalEvidence?.[target]?.status
    if (status && SETTLED_SIGNAL_STATUSES.includes(status)) settledQuestions.push(`answer ${turn.answerNumber}: asked about ${signalName(flow, target)} (${status})`)
  }
  // The open variant has no per-area question cap, so these describe its behaviour without failing it.
  const capped = flow.variant !== "open"
  add("no_question_on_settled_signal", capped, settledQuestions)
  add("attempt_limit", capped, [...asked].filter(([, count]) => count > MAX_SIGNAL_ATTEMPTS).map(([id, count]) => `${signalName(flow, id)} asked ${count} times`))

  // Groucho controls whether it asked, not what came back: closing with a signal neither evidenced nor
  // asked about is the thing to catch. Stops and the answer ceiling are legitimate reasons to leave one.
  const stopped = stops.some(event => run.turns.some(turn => turn.answerNumber === event.atAnswer))
  const untried = run.ended === "completed" && !stopped && run.turns.length < config.maxAnswers
    ? config.signals.filter(signal => signal.explore && !asked.has(signal.id) && !SETTLED_SIGNAL_STATUSES.includes(last?.signalEvidence?.[signal.id]?.status ?? "not_explored")).map(signal => signal.name)
    : []
  add("no_untried_signal_at_close", false, untried.length ? [`closed without asking about: ${untried.join(", ")}`] : [])

  // Groucho holds threads and raises them only when they connect, so an unused thread is not a fault.
  // An unused thread it rated highly relevant is worth reading, though.
  const unusedHigh = run.ended === "completed" && !stopped
    ? (last?.workingMemory?.threads ?? []).filter(thread => thread.relevance === "high" && !thread.followedAt && thread.turn < (last?.answerNumber ?? 0)).map(thread => `“${thread.quote}” (answer ${thread.turn})`)
    : []
  add("high_relevance_thread_unused", false, unusedHigh.length ? [`held but never raised: ${unusedHigh.join("; ")}`] : [])

  // Conversational habits that read badly. Heuristics: read the flagged turns before acting on them.
  const words = (text: string) => normalise(text).split(" ").filter(Boolean)
  const echoes = run.turns.filter(turn => turn.status === "active").flatMap(turn => {
    const opener = turn.reply.split(/(?<=[.!?])\s+/)[0] ?? ""
    if (/[?？]$/.test(opener.trim())) return []
    const said = words(turn.answer)
    const trigrams = new Set(said.slice(0, -2).map((_, index) => said.slice(index, index + 3).join(" ")))
    const mine = words(opener)
    return mine.slice(0, -2).some((_, index) => trigrams.has(mine.slice(index, index + 3).join(" "))) ? [`answer ${turn.answerNumber}: “${opener}”`] : []
  })
  add("echo_opener", false, echoes)
  add("double_question", false, run.turns.flatMap(turn => {
    const question = questionOf(turn.reply)
    return question && /,?\s\b(?:and|or)\s+(?:what|who|where|when|why|how|which|is|are|do|does|did|have|has|would|could)\b/i.test(question) ? [`answer ${turn.answerNumber}: “${question}”`] : []
  }))
  // Hypothetical questions show what someone thinks a good answer is, not what they do.
  add("hypothetical_question", false, run.turns.flatMap(turn => {
    const question = questionOf(turn.reply)
    return question && /\bif (?:someone|somebody|another|a friend|you were|you had|you joined|you did)\b|\bwhat would you (?:tell|say|do|suggest)\b|\bhow would you (?:respond|react|handle|give)\b/i.test(question) ? [`answer ${turn.answerNumber}: “${question}”`] : []
  }))
  // Groucho should simply change the subject, not announce it, and not justify a question by describing the project.
  add("announced_subject_change", false, run.turns.filter(turn => /\b(?:changing|change|switching|switch) (?:the )?(?:subject|topic|gears)\b|\bon (?:another|a different) note\b/i.test(turn.reply)).map(turn => `answer ${turn.answerNumber}: “${turn.reply.split(/(?<=[.!?])\s+/).find(sentence => /subject|topic|gears|note/i.test(sentence)) ?? turn.reply}”`))
  add("project_justified_question", false, run.turns.filter(turn => /\b(?:people|members|artists|creatives) (?:share|swap|post|bring)\b[^.?!]*\b(?:here|in the forum)\b[^?]*,\s*so\b/i.test(turn.reply)).map(turn => `answer ${turn.answerNumber}`))

  const seen = new Map<string, number>()
  const repeats: string[] = []
  for (const turn of active) {
    const question = questionOf(turn.reply)
    if (!question) continue
    const key = normalise(question)
    if (seen.has(key)) repeats.push(`answers ${seen.get(key)} and ${turn.answerNumber}: "${question}"`)
    else seen.set(key, turn.answerNumber)
  }
  add("no_repeated_question", true, repeats)

  if (config.replyStyle || flow.variant === "open") {
    add("one_question_per_reply", true, active.filter(turn => (turn.reply.match(/[?？]/g)?.length ?? 0) > 1).map(turn => `answer ${turn.answerNumber}: ${turn.reply.match(/[?？]/g)?.length} question marks`))
  }
  add("no_fallback_reply", false, run.turns.filter(turn => FALLBACK_REPLIES.some(text => turn.reply.includes(text))).map(turn => `answer ${turn.answerNumber}`))
  add("no_internal_terms", true, run.turns.filter(turn => INTERNAL_TERMS.test(turn.reply)).map(turn => `answer ${turn.answerNumber}: ${turn.reply.match(INTERNAL_TERMS)?.[0]}`))

  const eventProblems = (scenario.events ?? []).flatMap(event => {
    const turn = run.turns.find(candidate => candidate.answerNumber === event.atAnswer)
    if (!turn) return []
    return [
      ...(event.replyMustNotMatch ?? []).filter(pattern => new RegExp(pattern, "i").test(turn.reply)).map(pattern => `answer ${event.atAnswer} (${event.kind}): reply matches /${pattern}/`),
      ...(event.replyMustMatch ?? []).filter(pattern => !new RegExp(pattern, "i").test(turn.reply)).map(pattern => `answer ${event.atAnswer} (${event.kind}): reply lacks /${pattern}/`),
    ]
  })
  add("event_expectations", true, eventProblems)

  const statuses = finalStatuses(flow, run)
  add("expected_signals", false, Object.entries(scenario.expect?.signals ?? {}).flatMap(([name, allowed]) =>
    !signalId(flow, name) ? [`unknown signal "${name}"`] : allowed.includes(statuses[name]) ? [] : [`${name}: ${statuses[name]}, expected ${allowed.join(" or ")}`]))
  if (scenario.expect?.maxAnswers) add("expected_length", false, run.turns.length <= scenario.expect.maxAnswers ? [] : [`${run.turns.length} answers, expected at most ${scenario.expect.maxAnswers}`])
  return results
}

/** Share of items equal to the most common one. 1 means every repeat agreed. */
export function agreement(values: string[]): number {
  if (!values.length) return 1
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Math.max(...counts.values()) / values.length
}

export type ScenarioConsistency = {
  flow: string
  scenario: string
  repeats: number
  /** Per signal: the share of repeats that ended on the most common status, and the statuses seen. */
  signals: Record<string, { agreement: number; statuses: string[] }>
  statusAgreement: number
  /** Share of repeats whose questions targeted the same signals in the same order. */
  pathAgreement: number
  /** Share of repeats that agreed on the signal targeted by the first follow-up question. */
  firstQuestionAgreement: number
  answers: { min: number; max: number }
  paths: string[]
}

export function scenarioConsistency(flow: PilotFlow, scenario: Scenario, runs: PilotRun[]): ScenarioConsistency {
  const statuses = runs.map(run => finalStatuses(flow, run))
  const signals = Object.fromEntries(flow.config.signals.map(signal => {
    const seen = statuses.map(status => status[signal.name])
    return [signal.name, { agreement: agreement(seen), statuses: seen }]
  }))
  const paths = runs.map(run => questionPath(flow, run))
  const lengths = runs.map(run => run.turns.length)
  const agreements = Object.values(signals).map(signal => signal.agreement)
  return {
    flow: flow.slug, scenario: scenario.id, repeats: runs.length, signals,
    statusAgreement: agreements.reduce((sum, value) => sum + value, 0) / (agreements.length || 1),
    pathAgreement: agreement(paths.map(path => path.join(" > "))),
    firstQuestionAgreement: agreement(paths.map(path => path[0] ?? "(closed)")),
    answers: { min: Math.min(...lengths), max: Math.max(...lengths) },
    paths: paths.map(path => path.join(" > ") || "(closed)"),
  }
}

/** For a twin scenario: the share of signals whose most common final status matches the original's. */
export function twinAgreement(flow: PilotFlow, original: PilotRun[], twin: PilotRun[]): number {
  const modal = (runs: PilotRun[], name: string) => {
    const values = runs.map(run => finalStatuses(flow, run)[name])
    return [...new Set(values)].sort((a, b) => values.filter(v => v === b).length - values.filter(v => v === a).length)[0]
  }
  const names = flow.config.signals.map(signal => signal.name)
  return names.filter(name => modal(original, name) === modal(twin, name)).length / (names.length || 1)
}
