import { createHash } from "node:crypto"
import type Anthropic from "@anthropic-ai/sdk"
import { describe, expect, it, vi } from "vitest"
import { ARMS, EXPERIENCE, PERSONA, REPLAY_CASES, SHORT_GUIDANCE, type Arm } from "@/evals/conversation-replay-cases"

type Row = Record<string, unknown>
type Capture = { request: Anthropic.MessageCreateParamsNonStreaming; response: Anthropic.Message; ms: number }
const harness = vi.hoisted(() => ({
  tables: { sessions: [] as Row[], messages: [] as Row[] },
  arm: "control" as Arm,
  expectedCoverage: [] as string[],
  capture: null as Capture | null,
  providerError: null as null | { name: string; errorClass: string; status: number | null; requestId: string | null; message: string; cause: string | null; stack: string | null },
}))

// All persistence and external side effects are replaced. Unknown tables fail.
vi.mock("@/lib/supabase", () => ({ supabase: {
  from(table: string) {
    if (!(table in harness.tables)) throw new Error(`Unmocked table: ${table}`)
    const rows = harness.tables[table as keyof typeof harness.tables]
    const filters: Array<[string, unknown]> = []
    let pending: Row | null = null
    let inserted: Row | null = null
    const execute = () => {
      const matching = rows.filter((row) => filters.every(([key, value]) => row[key] === value))
      if (pending) matching.forEach((row) => Object.assign(row, pending))
      return { data: inserted ? [inserted] : matching, error: null }
    }
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return chain },
      is: (key: string, value: unknown) => { filters.push([key, value]); return chain },
      update: (value: Row) => { pending = value; return chain },
      insert: (value: Row) => { inserted = { id: `row_${rows.length}`, ...value }; rows.push(inserted); return chain },
      maybeSingle: async () => ({ data: execute().data[0] ?? null, error: null }),
      single: async () => ({ data: execute().data[0] ?? null, error: null }),
      then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return chain
  },
} }))
vi.mock("@/lib/project-resolution", () => ({
  resolveProjectContext: async () => ({ ok: true, context: { organisationId: "synthetic-org", projectId: "synthetic-project", apiKeyId: "synthetic-key", settings: { projectType: "gatekeeper", applicationExperience: EXPERIENCE, flowConfig: null, raw: { project_type: "gatekeeper" } } } }),
  touchApiKeyLastUsed: () => {},
}))
vi.mock("@/lib/persona-resolution", () => ({ resolveActiveGatekeeperPersona: async () => ({ id: "synthetic-persona", prompt: PERSONA, pass_threshold: 0.65, reject_threshold: 0.25 }) }))
vi.mock("@/lib/session-completion-jobs", () => ({ enqueueSessionCompletionJob: async () => {}, completeSessionImmediately: async () => {}, scheduleSessionCompletionDrain: () => {} }))
vi.mock("@/lib/automatic-application-decision", () => ({ recordAutomaticApplicationDecision: async () => null }))
vi.mock("@/lib/colors-youtube-feed", async (original) => ({ ...await original<typeof import("@/lib/colors-youtube-feed")>(), fetchLatestColorsShows: async () => [] }))
vi.mock("@/lib/logger", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock("@/lib/llm-usage", async (original) => ({ ...await original<typeof import("@/lib/llm-usage")>(), logLlmUsage: () => {} }))

function variant(original: Anthropic.MessageCreateParamsNonStreaming, arm: Arm) {
  const request = structuredClone(original)
  if (arm !== "control") {
    const content = request.messages[0].content
    if (typeof content !== "string") throw new Error("Expected compact text state")
    const start = content.lastIndexOf('\n\n{"questionBudget"')
    if (start < 0) throw new Error("Compact state boundary changed")
    const stateText = content.slice(start + 2)
    JSON.parse(stateText)
    request.messages[0].content = `${SHORT_GUIDANCE}\n\n${stateText}`
  }
  if (arm === "short_contract") {
    const schema = (request.tools![0] as Anthropic.Tool).input_schema as unknown as { properties: Record<string, { properties: Record<string, unknown>; required: string[] }> }
    for (const field of ["answerAssessment", "answerRelation"]) {
      delete schema.properties[field].properties.reason
      schema.properties[field].required = schema.properties[field].required.filter((name) => name !== "reason")
    }
    request.messages[0].content += "\nOmit the optional private reason strings; retain every other required field."
  }
  return request
}

vi.mock("@anthropic-ai/sdk", async (original) => {
  const actual = await original<typeof import("@anthropic-ai/sdk")>()
  return { default: class {
    messages = { create: async (originalRequest: Anthropic.MessageCreateParamsNonStreaming) => {
      const request = variant(originalRequest, harness.arm)
      const start = performance.now()
      let response: Anthropic.Message
      if (process.env.GROUCHO_LIVE_REPLAY === "1") {
        const client = new actual.default({ maxRetries: 0, timeout: 45000 })
        try {
          response = await client.messages.create(request)
        } catch (error) {
          const redact = (value: unknown) => String(value).replaceAll(process.env.ANTHROPIC_API_KEY ?? "__absent_key__", "[redacted]").slice(0,1500)
          const detail = error as { status?: unknown; requestID?: string; message?: unknown; cause?: { message?: unknown; code?: unknown }; stack?: unknown }
          harness.providerError = { name: error instanceof Error ? error.name : "Unknown", errorClass: error instanceof Error ? error.constructor.name : "Unknown", status: typeof detail.status === "number" ? detail.status : null, requestId: detail.requestID ?? null,
            message: redact(detail.message), cause: detail.cause ? redact(JSON.stringify({ message: detail.cause.message, code: detail.cause.code })) : null,
            stack: detail.stack ? redact(detail.stack) : null,
          }
          throw error
        }
      } else {
        response = { id: "dry", type: "message", role: "assistant", model: request.model, stop_reason: "tool_use", stop_sequence: null,
          content: [{ type: "tool_use", id: "dry-tool", name: "groucho_respond", input: { reply: "What part would you like to explore?", terminal: "none", scores: { specificity: 0.5, authenticity: 0.5, cultural_depth: 0.5, overall: 0.5 }, answerAssessment: { quality: "usable", reason: "Synthetic", evidenceFlags: ["detail"] }, answerRelation: { kind: "direct", reason: "Synthetic" }, conversationMove: "advance", coveredSignalKeys: harness.expectedCoverage, relevantSignalKeys: harness.expectedCoverage, nextSignalKey: "" } }],
          usage: { input_tokens: 0, output_tokens: 0 },
        } as Anthropic.Message
      }
      harness.capture = { request, response, ms: performance.now() - start }
      return response
    } }
  } }
})

type Result = {
  id: string; arm: Arm; repeat: number; status: number; handlerMs: number;
  modelMs: number | null; stopReason: string | null; inputTokens: number; outputTokens: number;
  cacheRead: number; cacheWrite: number; requestChars: number;
  rawReply: string; visibleReply: string; relation: string | null;
  rawCoverage: string[]; persistedCoverage: string[]; coverageTp: number; coverageFp: number; coverageFn: number;
  relationCorrect: boolean; earlyClose: boolean; replyRewritten: boolean;
  genericSelectorReplacement: boolean; structuredInputDowngraded: boolean;
  repair: boolean; markerPresent: boolean | null; mentionsCorrectedPlan: boolean | null;
}
const percentile = (values: number[], p: number) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  return Math.round(sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1))
}

describe("paired Groucho conversation replay", () => {
  it("runs the real handler with isolated storage and counterbalanced model variants", async () => {
    process.env.GROUCHO_RL_API_KEY_PER_MINUTE = "10000"
    process.env.GROUCHO_RL_SESSION_PER_MINUTE = "10000"
    delete process.env.GROUPCHO_LOCAL_GATEKEEPER_TEST_MODE
    const { postSessionMessage } = await import("@/lib/post-session-message")
    const { parseGatekeeperStructuredResponse } = await import("@/lib/gatekeeper-structured-tool")
    const { gatekeeperConversationModel } = await import("@/lib/gatekeeper-models")
    const results: Result[] = []
    const failures: Array<{ id: string; arm: Arm; repeat: number; handlerMs: number; status: number; providerError: typeof harness.providerError }> = []
    const requestHashes: string[] = []
    const live = process.env.GROUCHO_LIVE_REPLAY === "1"
    const diagnostic = process.env.GROUCHO_REPLAY_DIAGNOSTIC === "1"
    const requestedCase = process.env.GROUCHO_REPLAY_CASE
    const cases = requestedCase
      ? REPLAY_CASES.filter((fixture) => fixture.id === requestedCase)
      : diagnostic
        ? REPLAY_CASES.slice(0, 2)
        : REPLAY_CASES
    if (requestedCase && cases.length === 0) {
      throw new Error(`Unknown GROUCHO_REPLAY_CASE: ${requestedCase}`)
    }
    const repeats = diagnostic ? 1 : 2
    if (live && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required")
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (const [index, fixture] of cases.entries()) {
        const offset = (index + repeat) % ARMS.length
        const order = [...ARMS.slice(offset), ...ARMS.slice(0, offset)]
        for (const arm of order) {
          harness.arm = arm
          harness.expectedCoverage = fixture.expectedCoverage
          harness.capture = null
          harness.providerError = null
          harness.tables.sessions = [{ id: "s1", session_id: "synthetic-session", project_id: "synthetic-project", status: "active", persona_id: "synthetic-persona" }]
          harness.tables.messages = [
            { id: "opener", session_id: "s1", role: "assistant", content: EXPERIENCE.opening_message },
            ...(fixture.history ?? []).map((row) => ({ ...structuredClone(row), session_id: "s1" })),
            { id: "question", session_id: "s1", role: "assistant", content: fixture.question, metadata: { application_next_signal: { key: fixture.goal } } },
          ]
          const started = performance.now()
          const response = await postSessionMessage({ authorization: "Bearer synthetic", sessionId: "synthetic-session", message: fixture.answer })
          const handlerMs = performance.now() - started
          const body = await response.json()
          const capture = harness.capture as Capture | null
          if (!capture) {
            const failure = { id: fixture.id, arm, repeat, handlerMs: Math.round(handlerMs), status: response.status, providerError: harness.providerError }
            failures.push(failure)
            process.stdout.write("REPLAY_FAILURE=" + JSON.stringify(failure) + "\n")
            continue
          }
          const requestMessage = capture.request.messages[0].content as string
          const stateStart = requestMessage.lastIndexOf('\n\n{"questionBudget"')
          const stateLine = requestMessage.slice(stateStart + 2).split("\n")[0]
          expect(JSON.parse(stateLine).current.signalKey).toBe(fixture.goal)
          const parsed = capture ? parseGatekeeperStructuredResponse(capture.response.content) : null
          const requestText = capture ? JSON.stringify(capture.request) : ""
          requestHashes.push(createHash("sha256").update(requestText).digest("hex"))
          const user = harness.tables.messages.filter((row) => row.role === "user").at(-1)
          const assistant = harness.tables.messages.filter((row) => row.role === "assistant").at(-1)
          const metadata = assistant?.metadata as Row | undefined
          const userMetadata = user?.metadata as { application_signals?: Array<{ key: string }> } | undefined
          const coverage = userMetadata?.application_signals?.map((signal) => signal.key) ?? []
          const visibleReply = typeof body.message === "string" ? body.message : ""
          results.push({ id: fixture.id, arm, repeat, status: response.status,
            handlerMs: Math.round(handlerMs), modelMs: capture ? Math.round(capture.ms) : null,
            stopReason: capture?.response.stop_reason ?? null,
            inputTokens: capture?.response.usage.input_tokens ?? 0, outputTokens: capture?.response.usage.output_tokens ?? 0,
            cacheRead: capture?.response.usage.cache_read_input_tokens ?? 0, cacheWrite: capture?.response.usage.cache_creation_input_tokens ?? 0,
            requestChars: requestText.length, rawReply: parsed?.reply ?? "", visibleReply,
            relation: parsed?.answerRelation?.kind ?? null,
            rawCoverage: parsed?.coveredSignalKeys ?? [], persistedCoverage: coverage,
            coverageTp: coverage.filter((key) => fixture.expectedCoverage.includes(key)).length,
            coverageFp: coverage.filter((key) => !fixture.expectedCoverage.includes(key)).length,
            coverageFn: fixture.expectedCoverage.filter((key) => !coverage.includes(key)).length,
            relationCorrect: fixture.expectedRelation.includes(parsed?.answerRelation?.kind ?? ""),
            earlyClose: response.status === 200 && fixture.expectedActive && body.status !== "active",
            replyRewritten: Boolean(parsed && visibleReply !== parsed.reply),
            genericSelectorReplacement:
              visibleReply.includes("Which of these sounds most like how you participate around music?") &&
              !parsed?.reply.includes("Which of these sounds most like how you participate around music?"),
            structuredInputDowngraded:
              metadata?.application_structured_input_downgraded === true,
            repair: Boolean(metadata?.application_active_reply_repair || metadata?.application_turn_repair),
            markerPresent: fixture.memoryMarker ? requestText.includes(fixture.memoryMarker) : null,
            mentionsCorrectedPlan: fixture.memoryMarker ? /digest|access.notes|summaris|summariz/i.test(visibleReply) : null,
          })
          if (live) process.stdout.write("REPLAY_OBSERVATION=" + JSON.stringify(results.at(-1)) + "\n")
        }
        if (live) process.stdout.write(`Replay ${repeat + 1}/${repeats}: ${index + 1}/${cases.length} cases\n`)
      }
    }
    const summaries = Object.fromEntries(ARMS.map((arm) => {
      const rows = results.filter((row) => row.arm === arm)
      const sum = (field: "coverageTp" | "coverageFp" | "coverageFn" | "inputTokens" | "outputTokens" | "cacheRead" | "cacheWrite") => rows.reduce((n, row) => n + row[field], 0)
      return [arm, { requests: rows.length, errors: rows.filter((row) => row.status !== 200).length + failures.filter((row) => row.arm === arm).length,
        modelP50: percentile(rows.flatMap((row) => row.modelMs === null ? [] : [row.modelMs]), 0.5),
        modelP95: percentile(rows.flatMap((row) => row.modelMs === null ? [] : [row.modelMs]), 0.95),
        handlerP50: percentile(rows.map((row) => row.handlerMs), 0.5), handlerP95: percentile(rows.map((row) => row.handlerMs), 0.95),
        tp: sum("coverageTp"), fp: sum("coverageFp"), fn: sum("coverageFn"),
        relationCorrect: rows.filter((row) => row.relationCorrect).length,
        earlyCloses: rows.filter((row) => row.earlyClose).length,
        rewrites: rows.filter((row) => row.replyRewritten).length, repairs: rows.filter((row) => row.repair).length,
        genericSelectorReplacements: rows.filter((row) => row.genericSelectorReplacement).length,
        structuredInputDowngrades: rows.filter((row) => row.structuredInputDowngraded).length,
        truncations: rows.filter((row) => row.stopReason === "max_tokens").length,
        inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite"),
        memoryMarkerPresent: rows.filter((row) => row.markerPresent === true).length,
        memoryCorrectMentions: rows.filter((row) => row.mentionsCorrectedPlan === true).length,
      }]
    }))
    process.stdout.write("CONVERSATION_REPLAY_REPORT=" + JSON.stringify({ live, diagnostic, model: gatekeeperConversationModel(),
      fixtureSha256: createHash("sha256").update(JSON.stringify({ REPLAY_CASES, EXPERIENCE, PERSONA, SHORT_GUIDANCE })).digest("hex"),
      requestHashes, summaries, results, failures,
    }) + "\n")
    expect(results.length + failures.length).toBe(cases.length * repeats * ARMS.length)
    expect(failures).toEqual([])
    expect(results.filter((row) => row.status !== 200)).toEqual([])
  }, 900000)
})
