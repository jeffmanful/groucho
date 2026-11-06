/** Opt-in real-model replay. All persistence and usage logging are in memory. */
import { writeFileSync, mkdirSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ attempts: [] as unknown[], history: [] as Array<{role: string; content: string; metadata: Record<string, unknown>}> }))
vi.mock("@anthropic-ai/sdk", async importOriginal => {
  const { default: Client } = await importOriginal<typeof import("@anthropic-ai/sdk")>()
  return { default: class {
    private client = new Client({ maxRetries: 1, timeout: 45000 })
    messages = { create: async (request: import("@anthropic-ai/sdk").default.MessageCreateParamsNonStreaming) => {
      const response = await this.client.messages.create(request)
      state.attempts.push(response.content)
      return response
    } }
  } }
})
vi.mock("@/lib/supabase", () => ({ supabase: { from(table: string) {
  const chain = {
    select: () => chain, eq: () => chain, update: () => chain,
    order: async () => ({ data: [...state.history], error: null }),
    maybeSingle: async () => ({ data: { id: "local-replay", status: "active" }, error: null }),
    insert(value: typeof state.history[number]) {
      if (table !== "messages") throw new Error("Unexpected write")
      state.history.push(value)
      return { error: null, select: () => ({ single: async () => ({ data: { id: "local-user" }, error: null }) }) }
    },
  }
  return chain
} } }))
vi.mock("@/lib/llm-usage", async importOriginal => ({ ...await importOriginal<object>(), logLlmUsage: vi.fn() }))
vi.mock("@/lib/session-completion-jobs", () => ({ queueSessionCompletion: vi.fn() }))
import { postConversation, repeatsConversationQuestion } from "@/lib/conversation-engine"
import { DEMO_CONVERSATION_PROFILES, demoConversationPrompt } from "@/lib/demo-conversation-profiles"
import { LEWISHAM_SOCIAL_PERSONA_PROMPT } from "@/lib/lewisham-social-persona"
import { colorsThinConversationModel } from "@/lib/gatekeeper-models"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { brokenMoConversation, moHistoryBefore } from "@/lib/__tests__/fixtures/mo-nov6"

const profile = DEMO_CONVERSATION_PROFILES["lewisham-social"]
const evidence: unknown[] = []
async function reply(message: string) {
  const previousTurns = state.history.filter(m => m.role === "assistant")
  const response = await postConversation({
    context: { organisationId: "local", projectId: "local", apiKeyId: null, settings: normalizeProjectSettings({ application_experience: { max_turns: 10 } }) },
    sessionId: "local-replay", message, runCompletion: false,
    configuration: {
      ...profile, marker: "groucho_conversation_v1", model: colorsThinConversationModel(),
      closingMessage: profile.closing, completionMessage: profile.completion,
      buildPrompt: ({ turnCount }) => demoConversationPrompt(profile, LEWISHAM_SOCIAL_PERSONA_PROMPT, turnCount),
    },
  })
  const body = await response.json()
  evidence.push({ answer: message, response: body })
  mkdirSync("output/replays", { recursive: true })
  writeFileSync("output/replays/mo-nov6.json", JSON.stringify({ model: colorsThinConversationModel(), evidence, attempts: state.attempts }, null, 2))
  console.log(JSON.stringify({ answer: message, reply: body.message, details: body.details, status: body.status }))
  expect(response.status).toBe(200)
  expect(body.message).not.toContain("Server supplies the turn")
  expect(JSON.stringify(body.details)).not.toMatch(/not yet shared|asked who|not yet provided/i)
  if (body.status === "active") {
    expect(body.message.match(/\?/g)).toHaveLength(1)
    // A destination correction legitimately replaces the date options.
    const previous = previousTurns.filter(turn => !body.ui?.options ||
      JSON.stringify((turn.metadata.ui as { options?: string[] } | undefined)?.options) === JSON.stringify(body.ui.options))
      .map(turn => turn.content)
    expect(repeatsConversationQuestion(body.message, previous)).toBe(false)
    expect(body.message.match(/[^.!?]*\?$/)?.[0]).not.toMatch(/\band\s+(?:what|who|where|when|why|how|which|was|were|is|are|did|do|does|would|could|have|has|had|can|will|should|might|must)\b|\bor\s+(?:what|who|where|when|why|how|which)\b/i)
    const topic = body.ui?.options ? undefined : profile.questionTopic?.(body.message)
    if (topic) expect(previous.some(text => profile.questionTopic?.(text) === topic)).toBe(false)
  }
  return body
}

describe.skipIf(process.env.RUN_MO_LIVE_REPLAY !== "1")("Mo November 6 real-model replay", () => {
  it("recovers at each broken turn with the original conversation history", async () => {
    for (const index of [5, 7, 9]) {
      state.history = moHistoryBefore(index)
      const body = await reply(brokenMoConversation[index].content)
      expect(body.details.connection).toBeTruthy()
      expect(body.message).not.toMatch(/what (?:caught your ear|stays with you about that one)/i)
    }
  }, 180000)

  it("replays all five original answers then continues through tour preferences", async () => {
    state.history = moHistoryBefore(1)
    let body = { status: "active", details: {} as Record<string, string>, secret: undefined as string | undefined }
    for (const index of [1, 3, 5, 7, 9]) {
      body = await reply(brokenMoConversation[index].content)
      expect(body.details.otherInterests).toBeUndefined()
    }
    for (const answer of ["I listen to IDLES and go to small gigs.", "I'm bringing my sister.", "We're travelling from Bristol to the London show.", "London, Sat 17 Apr"]) {
      if (body.status === "completed") break
      body = await reply(answer)
    }
    expect(body.details.connection).toBeTruthy()
    expect(body.details.night).toBe("London, Sat 17 Apr")
    expect(body.details.location).toBe("Bristol")
    expect(body.details.preferredCity).toBe("London")
    expect(body.status).toBe("completed")
    expect(body.secret).toBeUndefined()
  }, 300000)
})
