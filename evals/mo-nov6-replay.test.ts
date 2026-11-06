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
import { postConversation } from "@/lib/conversation-engine"
import { DEMO_CONVERSATION_PROFILES, demoConversationPrompt } from "@/lib/demo-conversation-profiles"
import { LEWISHAM_SOCIAL_PERSONA_PROMPT } from "@/lib/lewisham-social-persona"
import { MO_CONVERSATION_MODEL } from "@/lib/gatekeeper-models"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { moPartnerIncident } from "@/lib/__tests__/fixtures/mo-partner-nov6"
import { brokenMoConversation, moHistoryBefore } from "@/lib/__tests__/fixtures/mo-nov6"

const profile = DEMO_CONVERSATION_PROFILES["lewisham-social"]
const replayModel = process.env.MO_REPLAY_MODEL || MO_CONVERSATION_MODEL
const evidence: unknown[] = []
async function reply(message: string) {
  const response = await postConversation({
    context: { organisationId: "local", projectId: "local", apiKeyId: null, settings: normalizeProjectSettings({ application_experience: { max_turns: 10 } }) },
    sessionId: "local-replay", message, runCompletion: false,
    configuration: {
      ...profile, marker: "groucho_conversation_v1", model: replayModel,
      closingMessage: profile.closing, completionMessage: profile.completion,
      buildPrompt: ({ turnCount }) => demoConversationPrompt(profile, LEWISHAM_SOCIAL_PERSONA_PROMPT, turnCount),
    },
  })
  const body = await response.json()
  evidence.push({ answer: message, response: body })
  mkdirSync("output/replays", { recursive: true })
  writeFileSync(process.env.MO_REPLAY_ARTIFACT || `output/replays/mo-nov6-${replayModel}.json`, JSON.stringify({ model: replayModel, evidence, attempts: state.attempts }, null, 2))
  console.log(JSON.stringify({ answer: message, reply: body.message, details: body.details, status: body.status }))
  expect(response.status).toBe(200)
  expect(body.message).not.toMatch(/^(?:placeholder|unused|none|null|server supplies the turn)\.?$/i)
  expect(JSON.stringify(body.details)).not.toMatch(/not yet shared|asked who|not yet provided/i)
  return body
}

describe.skipIf(process.env.RUN_MO_LIVE_REPLAY !== "1")("Mo November 6 real-model replay", () => {
  it("recovers at the original newcomer, listening and attribution corrections", async () => {
    for (const index of [7, 9, 13, 17]) {
      state.history = moPartnerIncident.slice(0, index).map((content, i) => ({
        role: i % 2 ? "user" : "assistant", content,
        metadata: { conversation_engine: "groucho_conversation_v1", conversation_profile: "lewisham-social" },
      }))
      const body = await reply(moPartnerIncident[index])
      expect(body.status).toBe("active")
      expect(body.message).not.toMatch(/(?:have you|do you|did you) (?:listened to|listen to|know|heard|hear) (?:any of )?(?:the|their) songs/i)
      expect(body.details.otherInterests ?? "").not.toMatch(/Same Again|partner/i)
      if ([7, 9, 13].includes(index)) expect(state.history.at(-1)?.metadata.conversation_memory).not.toEqual([])
    }
  }, 180000)

  it("sustains a fresh newcomer conversation beyond the old cutoff", async () => {
    state.history = moHistoryBefore(1)
    const answers = ["My partner introduced me to the band, but I haven't heard them or been to a show.",
      "He has loved them for years and wanted to share that with me.",
      "He likes Same Again because it reminds him of his friends. That's his experience, not mine.",
      "For me it's The Smiths. I like the vibe and the lyrics.",
      "I like how songs can be sad but still make you want to dance.",
      "I don't need a ticket yet, I'm just chatting. Tell me how Lewisham Social got started.",
      "I like that it came from friends wanting to keep meeting.",
      "What's your own favourite song of theirs?",
      "I might listen to that with my partner tonight.",
      "And what was it like putting those early nights on?",
      "I've helped friends put on a night too. We borrowed everything.",
      "The speakers failed halfway through. Everyone sang until we got them working again."]
    for (const answer of answers) {
      const body = await reply(answer)
      expect(body.status).toBe("active")
      expect(body.message).not.toMatch(/do you know any of the songs yet|which night would you prefer/i)
    }
    const memory = JSON.stringify(state.history.at(-1)?.metadata.conversation_memory)
    expect(memory).toMatch(/partner/i)
    expect(memory).toMatch(/not|never|hasn't|haven't|hadn't/i)
    const end = await reply("Thanks, can we stop?")
    expect(end.status).toBe("completed")
  }, 300000)

  it("leads organically from music to travel origin and an exact show preference", async () => {
    state.history = moHistoryBefore(1)
    const transcript: string[] = []
    for (const answer of ["My partner showed me Kitchen Light. The rough guitar and the lyrics grabbed me.",
      "It reminds me of a friend staying up after a long day.", "We both want to see them live."]) {
      const body = await reply(answer)
      transcript.push(body.message)
      expect(body.status).toBe("active")
    }
    expect(transcript.join(" ")).toMatch(/where|from|show|tour|night|city|live/i)
    let body = await reply("We're coming from Bristol, and we want to see them in London.")
    expect(body.details.location).toBe("Bristol")
    expect(body.details.preferredCity).toBe("London")
    if (!body.ui?.options) body = await reply("Which London night could we go to?")
    expect(body.ui.options).toEqual(["London, Sat 17 Apr", "London, Sun 18 Apr", "See other cities"])
    expect(body.message).toBe("Which London date would you prefer?")
    body = await reply("London, Sat 17 Apr")
    expect(body.details.night).toBe("London, Sat 17 Apr")
    expect(body.details.location).toBe("Bristol")
    if (body.status !== "completed") body = await reply("That settles it, thanks. Goodbye!")
    expect(body.completion.complete).toBe(true)
    expect(body.secret).toBeUndefined()
  }, 240000)

  it("follows a gig story beyond the first event and contributes band context", async () => {
    state.history = moHistoryBefore(1)
    for (const answer of ["A gig", "One of the Social Hours nights upstairs at the Railway Rooms. The last song went completely off plan.",
      "Ash dropped both sticks and the room started clapping the beat. Afterwards my mate took me to another night in New Cross.",
      "He laughed, picked the sticks up and came back in. We were still clapping on the way out."]) {
      const body = await reply(answer)
      expect(body.status).toBe("active")
    }
    const body = await reply("How did the band get started?")
    expect(body.message).toMatch(/pub|friends|2018/i)
    expect(body.message).not.toMatch(/reserved|code sent|booked you/i)
  }, 180000)

  it("accepts short original connection answers without repeating the same request", async () => {
    state.history = moHistoryBefore(1)
    const replies: string[] = []
    for (const index of [1, 3, 5, 7, 9]) {
      const body = await reply(brokenMoConversation[index].content)
      replies.push(body.message)
      expect(body.status).toBe("active")
    }
    expect(replies.filter(text => /what caught your ear/i.test(text)).length).toBeLessThan(2)
  }, 180000)
})
