import { randomUUID } from "node:crypto"
import { postConversation, type ConversationTranscriptEntry } from "@/lib/conversation-engine"
import { projectConversationOpening, projectConversationSettings } from "@/lib/project-conversation-config"
import { projectConversationConfiguration, projectConversationProfile } from "@/lib/project-conversation-runtime"
import { DEFAULT_INTERACTION_SPEC } from "@/lib/gatekeeper-interaction-spec"
import { normalizeProjectSettings } from "@/lib/project-settings"
import type { SignalEvidenceMap } from "@/lib/project-conversation-evidence"
import type { SignalTurn } from "@/lib/project-conversation-progress"
import { readWorkingMemory } from "@/lib/project-conversation-memory"
import type { ModelCall, PilotFlow, PilotRun, PilotTurn, Scenario } from "@/evals/pilot/types"

const RETRIES = 2

/** Scenario signal names that the flow's configuration does not have. */
export function unknownSignalNames(flow: PilotFlow, scenario: Scenario): string[] {
  const names = new Set(flow.config.signals.map(signal => signal.name))
  return [...Object.keys(scenario.answers), ...Object.keys(scenario.expect?.signals ?? {})].filter(name => !names.has(name))
}

/** The opening entry, built the same way the wizard preview builds it. */
function openingTranscript(flow: PilotFlow): ConversationTranscriptEntry[] {
  const runtime = projectConversationConfiguration(flow.config, { organisationId: flow.organisationId, projectId: flow.projectId }, { open: flow.variant === "open" })
  const profile = projectConversationProfile(flow.config)
  const choice = profile.openingChoice ? profile.choices[profile.openingChoice] : undefined
  const signalTurn = flow.config.signals.length ? { questionSignalId: profile.openingSignalId ?? null, followUp: false, changes: [] } : undefined
  return [{ role: "assistant", content: projectConversationOpening(flow.config), metadata: {
    conversation_engine: runtime.marker, conversation_profile: runtime.id,
    ...(profile.openingChoice ? { conversation_choice_key: profile.openingChoice } : {}),
    ...(signalTurn ? { conversation_signal_turn: signalTurn } : {}),
    ui: { ...DEFAULT_INTERACTION_SPEC, ...(choice ? { inputType: choice.inputType ?? "singleSelect", options: [...choice.options] } : {}) },
  } }]
}

/**
 * Run one scripted applicant through the saved configuration. This uses the wizard preview path:
 * the real prompt, models, validators and reviewers, with no application records, completion
 * jobs or webhooks. `callsFor` returns the model calls logged under a request id.
 */
export type Applicant = (scenario: Scenario, transcript: { role: "groucho" | "applicant"; content: string }[]) => Promise<{ text: string; costUsd: number }>

export async function runScenario(flow: PilotFlow, scenario: Scenario, repeat: number, callsFor: (requestId: string) => ModelCall[], applicant?: Applicant): Promise<PilotRun> {
  const context = { organisationId: flow.organisationId, projectId: flow.projectId, apiKeyId: null, settings: normalizeProjectSettings(projectConversationSettings(flow.config)) }
  const configuration = projectConversationConfiguration(flow.config, context, { open: flow.variant === "open" })
  const nameOf = (id: string | null | undefined) => flow.config.signals.find(signal => signal.id === id)?.name
  const used = new Map<string, number>()
  let fallbackIndex = 0
  let transcript = openingTranscript(flow)
  const run: PilotRun = { flow: flow.slug, scenario: scenario.id, repeat, opening: transcript[0].content, turns: [], ended: "answer_cap" }

  // Two answers of headroom past the ceiling, so a missed ceiling is recorded rather than hidden.
  for (let answerNumber = 1; answerNumber <= flow.config.maxAnswers + 2; answerNumber++) {
    const event = scenario.events?.find(candidate => candidate.atAnswer === answerNumber)
    const target = nameOf((transcript.at(-1)?.metadata.conversation_signal_turn as SignalTurn | undefined)?.questionSignalId)
    let answer: string
    let answerSource: string
    if (event) [answer, answerSource] = [event.say, `event:${event.kind}`]
    else if (answerNumber === 1) [answer, answerSource] = [scenario.opening, "opening"]
    else {
      const scripted = (): [string, string] => {
        const index = target ? used.get(target) ?? 0 : 0
        const line = target ? scenario.answers[target]?.[index] : undefined
        if (target && line) {
          used.set(target, index + 1)
          return [line, `signal:${target}`]
        }
        return [scenario.fallback[Math.min(fallbackIndex++, scenario.fallback.length - 1)] ?? "That's everything from me.",
          target ? `fallback (asked about ${target})` : "fallback (no signal target)"]
      }
      let played: { text: string; costUsd: number } | undefined
      for (let attempt = 0; applicant && !played && attempt < 2; attempt++) {
        const said = [{ role: "groucho" as const, content: run.opening }, ...run.turns.flatMap(turn => [{ role: "applicant" as const, content: turn.answer }, { role: "groucho" as const, content: turn.reply }])]
        played = await applicant(scenario, said).catch(() => undefined)
      }
      if (played) {
        run.applicantCostUsd = Number(((run.applicantCostUsd ?? 0) + played.costUsd).toFixed(6))
        ;[answer, answerSource] = [played.text, "applicant model"]
      } else [answer, answerSource] = applicant ? (([text, source]) => [text, `${source}, after the applicant model failed`])(scripted()) as [string, string] : scripted()
    }
    const turn: PilotTurn = { answerNumber, answer, answerSource, reply: "", status: "active", latencyMs: 0, calls: [], retries: 0 }
    let body: Record<string, unknown> | undefined
    let failure = ""
    for (let attempt = 0; attempt <= RETRIES && !body; attempt++) {
      const requestId = `pilot-${randomUUID()}`
      const started = performance.now()
      let firstText: number | undefined
      try {
        const response = await postConversation({ configuration, context, sessionId: randomUUID(), message: answer, previewTranscript: transcript, runCompletion: false, requestId,
          onReplyDelta: () => { firstText ??= performance.now() } })
        const result = await response.json() as Record<string, unknown>
        if (response.ok) body = result
        else failure = `${response.status}: ${String(result.error)}`
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      turn.latencyMs += Math.round(performance.now() - started)
      if (body && firstText !== undefined) turn.firstTextMs = Math.round(firstText - started)
      turn.calls.push(...callsFor(requestId))
      if (!body) turn.retries++
    }
    if (!body) {
      run.turns.push(turn)
      run.ended = "error"
      run.error = `answer ${answerNumber}: ${failure}`
      return run
    }
    transcript = body.previewTranscript as ConversationTranscriptEntry[]
    const metadata = transcript.at(-1)?.metadata ?? {}
    turn.reply = String(body.message)
    turn.status = body.status === "completed" ? "completed" : "active"
    turn.signalTurn = metadata.conversation_signal_turn as SignalTurn | undefined
    turn.signalEvidence = body.signalEvidence as SignalEvidenceMap | undefined
    turn.workingMemory = readWorkingMemory(metadata.conversation_working_memory)
    turn.model = typeof metadata.conversation_model === "string" ? metadata.conversation_model : undefined
    run.turns.push(turn)
    if (turn.status === "completed") {
      run.ended = "completed"
      return run
    }
  }
  return run
}

/** Run tasks with a fixed number in flight. Results keep the order of the tasks. */
export async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }))
  return results
}
