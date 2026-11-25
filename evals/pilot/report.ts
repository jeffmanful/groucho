import { projectConversationRevision } from "@/lib/project-conversation-runtime"
import { SIGNAL_EVIDENCE_LABELS } from "@/lib/project-conversation-evidence"
import { checkRun, finalStatuses, scenarioConsistency, twinAgreement, type ScenarioConsistency } from "@/evals/pilot/checks"
import type { CheckResult, PilotFlow, PilotRun, Scenario } from "@/evals/pilot/types"

export type PilotResults = {
  startedAt: string
  stub: boolean
  repeats: number
  flows: Array<{ slug: string; name: string; projectId: string; revision: string; pulledAt: string; replyStyle: string | null; maxAnswers: number }>
  runs: Array<PilotRun & { checks: CheckResult[] }>
  consistency: ScenarioConsistency[]
  twins: Array<{ flow: string; scenario: string; twinOf: string; agreement: number }>
  totals: { runs: number; turns: number; modelCalls: number; costUsd: number; applicantCostUsd: number; hardFailures: number; softFailures: number }
}

export function buildResults(input: { startedAt: string; stub: boolean; repeats: number; flows: PilotFlow[]; scenarios: Record<string, Scenario[]>; runs: PilotRun[] }): PilotResults {
  const flowOf = (slug: string) => input.flows.find(flow => flow.slug === slug)!
  const scenarioOf = (run: PilotRun) => input.scenarios[run.flow].find(scenario => scenario.id === run.scenario)!
  const runs = input.runs.map(run => ({ ...run, checks: checkRun(flowOf(run.flow), scenarioOf(run), run) }))
  const groups = new Map<string, PilotRun[]>()
  for (const run of input.runs) groups.set(`${run.flow}/${run.scenario}`, [...(groups.get(`${run.flow}/${run.scenario}`) ?? []), run])
  const consistency = [...groups.values()].map(group => scenarioConsistency(flowOf(group[0].flow), scenarioOf(group[0]), group))
  const twins = [...groups.values()].flatMap(group => {
    const scenario = scenarioOf(group[0])
    const original = scenario.twinOf ? groups.get(`${group[0].flow}/${scenario.twinOf}`) : undefined
    return scenario.twinOf && original ? [{ flow: group[0].flow, scenario: scenario.id, twinOf: scenario.twinOf, agreement: twinAgreement(flowOf(group[0].flow), original, group) }] : []
  })
  const turns = input.runs.flatMap(run => run.turns)
  const calls = turns.flatMap(turn => turn.calls)
  const failed = runs.flatMap(run => run.checks.filter(check => !check.pass))
  return {
    startedAt: input.startedAt, stub: input.stub, repeats: input.repeats,
    flows: input.flows.map(flow => ({ slug: flow.slug, name: flow.name, projectId: flow.projectId, revision: projectConversationRevision(flow.config), pulledAt: flow.pulledAt, replyStyle: flow.config.replyStyle ?? null, maxAnswers: flow.config.maxAnswers })),
    runs, consistency, twins,
    totals: { runs: runs.length, turns: turns.length, modelCalls: calls.length, costUsd: Number(calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0).toFixed(4)),
      applicantCostUsd: Number(input.runs.reduce((sum, run) => sum + (run.applicantCostUsd ?? 0), 0).toFixed(4)),
      hardFailures: failed.filter(check => check.hard).length, softFailures: failed.filter(check => !check.hard).length },
  }
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)] : 0
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export function renderReport(results: PilotResults): string {
  const lines: string[] = [`# Pilot harness report`, "", `Started ${results.startedAt}. ${results.repeats} repeat(s) per scenario.${results.stub ? " **Stub model: these numbers test the harness, not Groucho.**" : ""}`, ""]
  lines.push(`${results.totals.runs} conversations, ${results.totals.turns} turns, ${results.totals.modelCalls} model calls, estimated $${results.totals.costUsd}${results.totals.applicantCostUsd ? ` plus $${results.totals.applicantCostUsd} for the model playing applicants` : ""}. ${results.totals.hardFailures} hard check failure(s), ${results.totals.softFailures} soft.`, "")
  for (const flow of results.flows) {
    const runs = results.runs.filter(run => run.flow === flow.slug)
    const turns = runs.flatMap(run => run.turns)
    const latencies = turns.map(turn => turn.latencyMs)
    const models = [...new Set(turns.flatMap(turn => turn.calls.map(call => `${call.operation}: ${call.model}`)))].sort()
    lines.push(`## ${flow.name}`, "", `Project \`${flow.projectId}\`, configuration \`${flow.revision.slice(0, 12)}\` pulled ${flow.pulledAt}. Reply style: ${flow.replyStyle ?? "none"}. Answer ceiling: ${flow.maxAnswers}.`, "")
    const attempts = runs.flatMap(run => run.turns.at(-1)?.workingMemory?.attempts ?? [])
    if (attempts.length) lines.push(`Questions towards a signal: ${attempts.length}. Built on the applicant's own words: ${percent(attempts.filter(attempt => attempt.buildsOn).length / attempts.length)}. Passed over by the applicant: ${attempts.filter(attempt => attempt.outcome === "passed_over").length}.`, "")
    const steers = turns.flatMap(turn => turn.signalTurn?.selfCheck ? [turn.signalTurn.selfCheck] : [])
    if (steers.length) lines.push(`Self-check steered ${steers.length} of ${turns.length} turns: ${[...new Set(steers)].map(kind => `${kind.replace(/_/g, " ")} ${steers.filter(item => item === kind).length}`).join(", ")}.`, "")
    const firstText = turns.flatMap(turn => turn.firstTextMs === undefined ? [] : [turn.firstTextMs])
    if (firstText.length) lines.push(`First reply text appeared after p50 ${seconds(percentile(firstText, 0.5))}, p95 ${seconds(percentile(firstText, 0.95))} (${firstText.length} of ${turns.length} turns streamed).`, "")
    const replyReady = turns.flatMap(turn => turn.replyReadyMs === undefined ? [] : [turn.replyReadyMs])
    if (replyReady.length) lines.push(`Reply text complete after p50 ${seconds(percentile(replyReady, 0.5))}, p95 ${seconds(percentile(replyReady, 0.95))}.`, "")
    if (turns.length) lines.push(`Turn latency p50 ${seconds(percentile(latencies, 0.5))}, p95 ${seconds(percentile(latencies, 0.95))}. Model calls per turn: ${(turns.reduce((sum, turn) => sum + turn.calls.length, 0) / turns.length).toFixed(1)}.`, "", ...models.map(model => `- ${model}`), "")
    lines.push("### Consistency across repeats", "", "| Scenario | Final signal states agree | Same question path | Same first question | Answers | Checks failed (hard/soft) |", "| --- | ---: | ---: | ---: | ---: | ---: |")
    for (const item of results.consistency.filter(entry => entry.flow === flow.slug)) {
      const failed = runs.filter(run => run.scenario === item.scenario).flatMap(run => run.checks.filter(check => !check.pass))
      lines.push(`| ${item.scenario} | ${percent(item.statusAgreement)} | ${percent(item.pathAgreement)} | ${percent(item.firstQuestionAgreement)} | ${item.answers.min === item.answers.max ? item.answers.min : `${item.answers.min}–${item.answers.max}`} | ${failed.filter(check => check.hard).length}/${failed.filter(check => !check.hard).length} |`)
    }
    lines.push("")
    for (const twin of results.twins.filter(entry => entry.flow === flow.slug)) lines.push(`Fairness pair: \`${twin.scenario}\` reached the same final state as \`${twin.twinOf}\` on ${percent(twin.agreement)} of signals.`, "")
    const unstable = results.consistency.filter(entry => entry.flow === flow.slug).flatMap(entry => Object.entries(entry.signals).filter(([, signal]) => signal.agreement < 1).map(([name, signal]) => `- ${entry.scenario} / ${name}: ${signal.statuses.join(", ")}`))
    if (unstable.length) lines.push("### Signals that ended differently between repeats", "", ...unstable, "")
    const failures = runs.flatMap(run => run.checks.filter(check => !check.pass).map(check => `- ${check.hard ? "**hard**" : "soft"} \`${check.check}\` in ${run.scenario} #${run.repeat}: ${check.detail}`))
    if (failures.length) lines.push("### Failed checks", "", ...failures, "")
  }
  lines.push("Agreement is the share of repeats that matched the most common result. Read the transcripts alongside these numbers: passing checks do not show that a conversation was good.", "")
  return lines.join("\n")
}

export function renderTranscripts(results: PilotResults, flows: PilotFlow[]): string {
  const lines: string[] = ["# Pilot harness transcripts", ""]
  for (const run of results.runs) {
    const flow = flows.find(candidate => candidate.slug === run.flow)!
    const name = (id: string | null | undefined) => flow.config.signals.find(signal => signal.id === id)?.name
    const failed = run.checks.filter(check => !check.pass)
    lines.push(`## ${run.flow} / ${run.scenario} #${run.repeat}`, "", `Ended: ${run.ended}${run.error ? ` (${run.error})` : ""}. ${failed.length ? `Failed: ${failed.map(check => check.check).join(", ")}.` : "All checks passed."}`, "", `**Groucho:** ${run.opening}`, "")
    for (const turn of run.turns) {
      const changes = (turn.signalTurn?.changes ?? []).map(change => `${name(change.signalId)} → ${SIGNAL_EVIDENCE_LABELS[change.status]}`)
      lines.push(`**Applicant** (${turn.answerSource}): ${turn.answer}`, "", `**Groucho:** ${turn.reply.replace(/\n+/g, " / ")}`, "",
        `> ${[...(turn.signalTurn?.answerRelation ? [`answer ${turn.signalTurn.answerRelation.replace(/_/g, " ")}`] : []),
          ...(turn.signalTurn?.selfCheck ? [`self-check: ${turn.signalTurn.selfCheck.replace(/_/g, " ")}`] : []),
          turn.signalTurn?.questionSignalId ? `asks about ${name(turn.signalTurn.questionSignalId)}${turn.signalTurn.buildsOn ? `, building on “${turn.signalTurn.buildsOn}”` : " (plain question)"}`
            : turn.status === "completed" ? "closes" : turn.signalTurn?.buildsOn ? `follows up “${turn.signalTurn.buildsOn}”` : "no signal target", ...changes, seconds(turn.latencyMs), `${turn.calls.length} calls`, ...(turn.retries ? [`${turn.retries} retry`] : [])].join(" · ")}`, "")
    }
    // Everything the engine carries forward about the applicant is this per-signal evidence.
    const stored = run.turns.at(-1)?.signalEvidence ?? {}
    lines.push("### What Groucho stored", "", ...flow.config.signals.flatMap(signal => {
      const item = stored[signal.id]
      const status = SIGNAL_EVIDENCE_LABELS[finalStatuses(flow, run)[signal.name]]
      return [`- **${signal.name}** (${status})${item?.summary ? `: ${item.summary}` : ""}`,
        ...(item?.sources ?? []).map(source => `  - answer ${source.turn}: “${source.quote}”`)]
    }), "")
    const memory = run.turns.at(-1)?.workingMemory
    if (memory?.threads.length) lines.push("### Threads Groucho noticed", "", ...memory.threads.map(thread =>
      `- ${thread.id}, answer ${thread.turn}, ${thread.relevance ?? "unrated"} relevance: “${thread.quote}”${thread.whyItMatters ? `. Why it might matter: ${thread.whyItMatters}` : ""}. ${thread.followedAt ? `Followed up after answer ${thread.followedAt}${thread.asks && thread.asks > 1 ? ` (${thread.asks} questions)` : ""}.` : "Not followed up."}${thread.finishedAt ? ` Talked through by answer ${thread.finishedAt}.` : ""}`), "")
    if (memory?.attempts.length) lines.push("### Questions Groucho asked towards a signal", "", ...memory.attempts.map(attempt =>
      `- ${name(attempt.signalId)}, after answer ${attempt.turn}: “${attempt.question.replace(/\n+/g, " / ")}” ${attempt.buildsOn ? `Built on “${attempt.buildsOn}”.` : "Plain question."} Outcome: ${(attempt.outcome ?? "no answer recorded").replace(/_/g, " ")}.`), "")
  }
  return lines.join("\n")
}
