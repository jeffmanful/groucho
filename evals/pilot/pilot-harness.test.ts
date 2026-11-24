/**
 * Pilot harness for the COLORS Forum flows. Opt-in: it makes paid model calls unless PILOT_STUB=1.
 * It runs each scripted applicant several times through the saved project configuration and
 * reports rule checks and how consistent the repeats were. See evals/pilot/README.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { ModelCall, PilotFlow } from "@/evals/pilot/types"

const state = vi.hoisted(() => ({ calls: new Map<string, unknown[]>() }))
const STUB = process.env.PILOT_STUB === "1"

// Nothing here may touch application data or downstream delivery.
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => { throw new Error(`Pilot harness must not use the database (${table})`) } } }))
vi.mock("@/lib/session-completion-jobs", () => ({ queueSessionCompletion: () => { throw new Error("Pilot harness must not queue completion jobs") } }))
vi.mock("@/lib/logger", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock("@/lib/llm-usage", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/llm-usage")>()
  return { ...original, logLlmUsage: async (input: import("@/lib/llm-usage").LlmUsageLogInput) => {
    if (!input.requestId) return
    const usage = (input.usage ?? {}) as { input_tokens?: number; output_tokens?: number }
    const call: ModelCall = { operation: input.operation, model: input.model, inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, costUsd: original.estimateLlmCostUsd(input.model, input.usage) }
    state.calls.set(input.requestId, [...(state.calls.get(input.requestId) ?? []), call])
  } }
})
vi.mock("@anthropic-ai/sdk", async importOriginal => {
  const original = await importOriginal<typeof import("@anthropic-ai/sdk")>()
  if (process.env.PILOT_STUB !== "1") return original
  const { stubMessage } = await import("@/evals/pilot/stub-model")
  return { ...original, default: class { messages = { create: async (request: Parameters<typeof stubMessage>[0]) => stubMessage(request) } } }
})

import { validateProjectConversation } from "@/lib/project-conversation-config"
import { PILOT_SCENARIOS } from "@/evals/pilot/scenarios"
import { runPool, runScenario, unknownSignalNames } from "@/evals/pilot/runner"
import { modelApplicant } from "@/evals/pilot/applicant-model"
import { buildResults, renderReport, renderTranscripts } from "@/evals/pilot/report"

const list = (value: string | undefined) => value?.split(",").map(item => item.trim()).filter(Boolean)
const slugs = list(process.env.PILOT_FLOWS) ?? Object.keys(PILOT_SCENARIOS)
const only = list(process.env.PILOT_SCENARIOS)
const variants = list(process.env.PILOT_VARIANTS) ?? ["guided"]
// A model plays the applicant by default on live runs, so answers respond to the actual question.
const applicantMode = process.env.PILOT_APPLICANT ?? (STUB ? "script" : "model")
const repeats = Math.max(1, Number(process.env.PILOT_REPEATS ?? 3))
const concurrency = Math.max(1, Number(process.env.PILOT_CONCURRENCY ?? 3))

function loadFlow(slug: string): PilotFlow {
  const file = path.join("evals/pilot/flows", `${slug}.json`)
  if (!existsSync(file)) throw new Error(`Missing ${file}. Run "pnpm pilot:pull" to save the project's configuration.`)
  const flow = JSON.parse(readFileSync(file, "utf8")) as PilotFlow
  const validated = validateProjectConversation(flow.config)
  if (!validated.ok || validated.config.version !== 2) throw new Error(`${file} is not a valid signal conversation: ${validated.ok ? "version 1" : validated.error}`)
  return { ...flow, config: validated.config }
}

describe.skipIf(process.env.RUN_PILOT_HARNESS !== "1")("COLORS Forum pilot harness", () => {
  it("runs every scenario and writes a report", async () => {
    if (!STUB && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Use pnpm pilot:run, or pnpm pilot:stub for a run without model calls.")
    const startedAt = new Date().toISOString()
    // Each variant runs the same saved configuration and the same scripted applicants.
    const flows = slugs.flatMap(slug => variants.map(variant => {
      const flow = loadFlow(slug)
      return variant === "open" ? { ...flow, slug: `${slug}+open`, name: `${flow.name} (open conversation)`, variant: "open" as const } : flow
    }))
    const scenarios = Object.fromEntries(flows.map(flow => [flow.slug, (PILOT_SCENARIOS[flow.slug.replace(/\+open$/, "")] ?? []).filter(scenario => !only || only.includes(scenario.id))]))
    const unknown = flows.flatMap(flow => scenarios[flow.slug].flatMap(scenario => unknownSignalNames(flow, scenario).map(name => `${flow.slug}/${scenario.id}: "${name}"`)))
    if (unknown.length) throw new Error(`Scenarios name signals the saved configuration does not have. Update evals/pilot/scenarios.ts:\n${unknown.join("\n")}`)

    const applicant = applicantMode === "model" ? modelApplicant(process.env.PILOT_APPLICANT_MODEL) : undefined
    const tasks = flows.flatMap(flow => scenarios[flow.slug].flatMap(scenario => Array.from({ length: repeats }, (_, index) => async () => {
      const run = await runScenario(flow, scenario, index + 1, requestId => (state.calls.get(requestId) ?? []) as ModelCall[], applicant)
      console.log(`${flow.slug}/${scenario.id} #${index + 1}: ${run.ended}, ${run.turns.length} answers`)
      return run
    })))
    expect(tasks.length).toBeGreaterThan(0)
    const runs = await runPool(tasks, concurrency)
    const results = buildResults({ startedAt, stub: STUB, repeats, flows, scenarios, runs })

    const directory = path.join("output/pilot", `${startedAt.replace(/[:.]/g, "-")}${STUB ? "-stub" : ""}`)
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2))
    writeFileSync(path.join(directory, "report.md"), renderReport(results))
    writeFileSync(path.join(directory, "transcripts.md"), renderTranscripts(results, flows))
    console.log(`\n${renderReport(results)}\nWritten to ${directory}`)

    expect(runs).toHaveLength(tasks.length)
    if (process.env.PILOT_STRICT === "1") expect(results.totals.hardFailures).toBe(0)
  }, 60 * 60_000)
})
