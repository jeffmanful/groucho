import { beforeEach, describe, expect, it, vi } from "vitest"

const { createMock, streamMock, queueMock, state } = vi.hoisted(() => ({
  createMock: vi.fn(),
  streamMock: vi.fn(),
  queueMock: vi.fn(async () => {}),
  state: {
    audience: "community",
    inserted: [] as Array<{ role: string; content: string; metadata?: Record<string, unknown> }>,
    sessionUpdates: [] as Array<{ status: string }>,
    history: [] as Array<{ id: string; role: string; content: string; metadata: Record<string, unknown> }>,
  },
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock, stream: streamMock }
  },
}))
vi.mock("@/lib/gatekeeper-models", () => ({ gatekeeperConversationModel: () => "test-model", colorsThinConversationModel: () => "test-model", supportsForcedToolChoice: (model: string) => !model.startsWith("claude-sonnet-5") }))
vi.mock("@/lib/llm-usage", () => ({ logLlmUsage: vi.fn() }))
vi.mock("@/lib/session-completion-jobs", () => ({ queueSessionCompletion: queueMock }))
vi.mock("@/lib/colors-youtube-feed", () => ({ fetchLatestColorsShows: vi.fn(async () => []) }))
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        order: async () => ({ data: state.history, error: null }),
        maybeSingle: async () => ({ data: {
          id: "row-1", status: "active", applicant_email: "tester@example.com",
          application_audience: state.audience, applicant_details: { city: "Private Intake City", age: 27 },
        }, error: null }),
        update(value: { status: string }) {
          state.sessionUpdates.push(value)
          return chain
        },
        insert(value: { role: string; content: string }) {
          if (table !== "messages") throw new Error("Unexpected insert")
          state.inserted.push(value)
          return {
            error: null,
            select() { return { single: async () => ({ data: { id: "user-1" }, error: null }) } },
          }
        },
      }
      return chain
    },
  },
}))

import {
  colorsThinConversationPrompt,
  conversationalClosing,
  DEFAULT_CONSENT_QUESTION,
  partialReplyFromJson,
  postColorsThinConversation,
  SOFT_CLOSE_ANSWERS,
  WRAP_UP_ANSWERS,
} from "@/lib/colors-thin-conversation"
import type { ProjectContext } from "@/lib/project-resolution"
import type { ApplicantIdentity } from "@/lib/applicant-identity"

const context = {
  organisationId: "org-1",
  projectId: "project-1",
  settings: { applicationExperience: { max_turns: 1, closing_message: "Thanks for talking." } },
} as unknown as ProjectContext
const applicant = { email: "tester@example.com" } as ApplicantIdentity

function toolReply(reply: string, close: boolean, addsNewContext?: boolean) {
  return {
    stop_reason: "tool_use",
    usage: {},
    content: [{ type: "tool_use", name: "groucho_converse", input: {
      reply, close, boundary: "none", boundaryQuestion: "", ...(addsNewContext === undefined ? {} : { addsNewContext }),
    } }],
  }
}

function jsonReply(reply: string, close: boolean) {
  return {
    stop_reason: "end_turn",
    usage: {},
    content: [{ type: "text", text: JSON.stringify({ reply, addsNewContext: true, close, boundary: "none", boundaryQuestion: "" }) }],
  }
}

/** A MessageStream stand-in for structured JSON output: emits growing text snapshots. */
function streamedJsonReply(reply: string, close: boolean) {
  const listeners: Array<(delta: string, snapshot: string) => void> = []
  const text = JSON.stringify({ reply, addsNewContext: true, close, boundary: "none", boundaryQuestion: "" })
  return {
    on(event: string, listener: (delta: string, snapshot: string) => void) {
      if (event === "text") listeners.push(listener)
      return this
    },
    async finalMessage() {
      for (let end = 1; end <= text.length; end += 5) listeners.forEach(listener => listener("", text.slice(0, end)))
      return jsonReply(reply, close)
    },
  }
}

/** A stand-in for the SDK's MessageStream: emits growing JSON snapshots, then the final message. */
function streamedToolReply(reply: string, close: boolean) {
  const listeners: Array<(partial: string, snapshot: unknown) => void> = []
  return {
    on(event: string, listener: (partial: string, snapshot: unknown) => void) {
      if (event === "inputJson") listeners.push(listener)
      return this
    },
    async finalMessage() {
      for (let end = 1; end <= reply.length; end += 7) {
        listeners.forEach(listener => listener("", { reply: reply.slice(0, end) }))
      }
      listeners.forEach(listener => listener("", { reply, close }))
      return toolReply(reply, close, true)
    },
  }
}

describe("thin pilot close after an applicant question", () => {
  beforeEach(() => {
    createMock.mockReset()
    streamMock.mockReset()
    queueMock.mockClear()
    state.audience = "community"
    state.inserted = []
    state.sessionUpdates = []
    state.history = [{
      id: "opening-1", role: "assistant", content: "Why would you join?",
      metadata: { conversation_engine: "colors_thin_pilot_v1" },
    }]
  })

  function priorSettledAnswers() {
    state.history.push(
      { id: "answer-1", role: "user", content: "I want feedback.", metadata: {} },
      { id: "reply-1", role: "assistant", content: "What would make that useful?", metadata: { conversation_progress: { adds_new_context: false } } },
      { id: "answer-2", role: "user", content: "Just feedback really.", metadata: {} },
      { id: "reply-2", role: "assistant", content: "What are you hoping to hear?", metadata: { conversation_progress: { adds_new_context: false } } },
    )
  }

  it("closes repeated no-progress answers instead of persisting another probe", async () => {
    priorSettledAnswers()
    createMock.mockResolvedValueOnce(toolReply("What would make feedback useful?", false, false))
      .mockResolvedValueOnce(toolReply("You are looking for other people to hear what you make.", true))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "I do not know. Just honest feedback.", applicant })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message).not.toContain("?")
    expect(state.inserted.at(-1)?.metadata).toMatchObject({ conversation_progress: { adds_new_context: false, stop_reason: "no_new_context" } })
  })

  it("lets a genuinely new detail continue even after earlier stalled answers", async () => {
    priorSettledAnswers()
    createMock.mockResolvedValueOnce(toolReply("What changed when you tried the dry vocal?", false, true))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "Actually a friend noticed the reverb hid my vocal, and I tried a dry version.", applicant })
    expect((await response.json()).status).toBe("active")
    expect(state.sessionUpdates).toEqual([])
  })

  it("answers a real applicant question despite the no-progress guard", async () => {
    priorSettledAnswers()
    createMock.mockResolvedValueOnce(toolReply("You can share public music links. What would you like to discuss?", false, false))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "Can I share a public music link?", applicant })
    expect((await response.json()).status).toBe("active")
    expect(state.inserted.at(-1)?.metadata).toMatchObject({ conversation_progress: { adds_new_context: true } })
  })

  it("keeps a concrete consent boundary open rather than applying the no-progress close", async () => {
    priorSettledAnswers()
    const response = toolReply("Ask permission before sharing someone else's private demo. Would you ask first?", false, false)
    response.content[0].input.boundary = "consent"
    response.content[0].input.boundaryQuestion = "Would you ask permission first?"
    createMock.mockResolvedValueOnce(response)
    const result = await postColorsThinConversation({ context, sessionId: "session-1", message: "I would share someone else's private demo without asking.", applicant })
    expect((await result.json()).status).toBe("active")
    expect(state.sessionUpdates).toEqual([])
  })

  it("uses a fixed consent question instead of failing when the model's wording misses", async () => {
    const response = toolReply("Sharing someone else's private demo without them knowing crosses a line. What else would you post?", false, true)
    response.content[0].input.boundary = "consent"
    response.content[0].input.boundaryQuestion = "What do you think about that?"
    createMock.mockResolvedValueOnce(response)
    const result = await postColorsThinConversation({ context, sessionId: "session-1", message: "I post other producers' unreleased demos I get sent privately.", applicant })
    const body = await result.json()
    expect(result.status).toBe(200)
    expect(body.status).toBe("active")
    expect(body.message).toBe(`Sharing someone else's private demo without them knowing crosses a line. ${DEFAULT_CONSENT_QUESTION}`)
  })

  it("allows a statement beginning with when to close without spurious question repairs", async () => {
    createMock.mockResolvedValueOnce(toolReply("You notice how vocal detail carries a stripped-back performance.", true, true))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "The small choices matter. When there's less arrangement to hide behind, those details become the performance itself.", applicant })
    expect((await response.json()).status).toBe("completed")
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it("does not turn a rhetorical you-know tag into a question-repair failure", async () => {
    createMock.mockResolvedValueOnce(toolReply("You are still exploring what you want to make.", true, false))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "I'm not totally sure yet. Just feels off sometimes, you know?", applicant })
    expect((await response.json()).status).toBe("completed")
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it("allows an ordinary questionless-reply repair to produce a valid natural close", async () => {
    createMock.mockResolvedValueOnce(toolReply("You want people to exchange listening notes with.", false))
      .mockResolvedValueOnce(toolReply("You want people to exchange listening notes with.", true))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "I'd like to exchange notes about music.", applicant })
    expect((await response.json()).status).toBe("completed")
    expect(state.inserted.map(entry => entry.role)).toEqual(["user", "assistant"])
  })

  it("repairs malformed answers internally with corrective feedback and saves the answer once", async () => {
    createMock.mockResolvedValueOnce(toolReply("Thanks for talking.", true))
      .mockResolvedValueOnce(toolReply("Thanks for talking.", true))
      .mockResolvedValueOnce(toolReply("The Forum is for discussing music and sharing public links. What would you like to explore?", false))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "Can I share public links?", applicant })
    expect((await response.json()).status).toBe("active")
    expect(createMock).toHaveBeenCalledTimes(3)
    expect(createMock.mock.calls[2][0].system).toContain("last repair was unusable")
    expect(state.inserted.map(entry => entry.role)).toEqual(["user", "assistant"])
  })

  it("keeps a usable close when the optional acknowledgment request fails", async () => {
    createMock.mockResolvedValueOnce(toolReply("We have enough to move forward.", true))
      .mockRejectedValueOnce(new Error("Synthetic provider timeout"))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "I'd like to exchange listening notes.", applicant })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: "completed", message: "Thanks for talking." })
    expect(state.inserted.map(entry => entry.role)).toEqual(["user", "assistant"])
  })

  it("leaves an exhausted genuine-question repair retryable without persisting the answer", async () => {
    createMock.mockResolvedValue(toolReply("Thanks for talking.", true))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "Can I share public links?", applicant })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ retryable: true })
    expect(createMock).toHaveBeenCalledTimes(3)
    expect(state.inserted).toEqual([])
    expect(state.sessionUpdates).toEqual([])
  })

  it.each(["artist", "community"])("keeps saved %s guidance through a question repair, regardless of submitted audience", async audience => {
    state.audience = audience
    createMock.mockResolvedValueOnce(toolReply("It was good talking with you.", true))
      .mockResolvedValueOnce(toolReply("A small exchange can help. What would you like to explore?", false))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "Could I take part without public releases?", applicant: { ...applicant, ...(audience === "community" ? { artist: { city: "Other City", age: 30, socialLinks: [], musicLinks: [] } } : {}) } })
    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe("active")
    expect(createMock).toHaveBeenCalledTimes(2)
    for (const [request] of createMock.mock.calls) {
      expect(request.system).toContain(audience === "artist" ? "artist-focused COLORS Forum application" : "general community application")
      expect(request.system).not.toContain(audience === "artist" ? "general community application" : "artist-focused COLORS Forum application")
      expect(request.system).not.toContain("Private Intake City")
      expect(request.system).not.toContain("Other City")
    }
  })

  it("answers a final question and keeps the session active even at the turn limit", async () => {
    createMock
      .mockResolvedValueOnce(toolReply("It was good talking with you.", true))
      .mockResolvedValueOnce(toolReply(
        "The Forum is meant for discussing and sharing music with other people, including live-event conversations. What would make it feel tapped in to you?",
        false,
      ))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1",
      message: "I want a space that feels more tapped in. Is this something the Forum can provide?",
      applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("active")
    expect(body.message).toContain("The Forum is meant for discussing")
    expect(body.message).toContain("What would make it feel tapped in to you?")
    expect(state.sessionUpdates).toEqual([])
    expect(state.inserted.map((entry) => entry.role)).toEqual(["user", "assistant"])
    expect(createMock).toHaveBeenCalledTimes(2)
  })

  it("does not save or close when a question-answer repair fails", async () => {
    createMock
      .mockResolvedValueOnce(toolReply("Thanks for talking.", true))
      .mockResolvedValueOnce(toolReply("Thanks for talking.", true))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "Can the Forum provide that?", applicant,
    })
    expect(response.status).toBe(503)
    expect(state.inserted).toEqual([])
    expect(state.sessionUpdates).toEqual([])
  })

  it("does not let the emergency turn limit override a valid answer to a question", async () => {
    createMock.mockResolvedValueOnce(toolReply(
      "The Forum will have space for music discussion and sharing public links. What kind of exchange are you hoping for?",
      false,
    ))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "Can the Forum offer that", applicant,
    })
    expect((await response.json()).status).toBe("active")
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(state.sessionUpdates).toEqual([])
  })

  it("adds a specific acknowledgment before the neutral closing line", async () => {
    createMock.mockResolvedValueOnce(toolReply("Your idea of trading discoveries with other listeners sounds lively.", true))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "I would like to talk about music here.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message).toBe(
      "Your idea of trading discoveries with other listeners sounds lively.\n\nThanks for talking.",
    )
    expect(state.sessionUpdates).toEqual([{ status: "completed" }])
  })

  it("drops a closing process claim without a second model call", async () => {
    createMock.mockResolvedValueOnce(toolReply("I think we have enough to move forward.", true))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1",
      message: "I would use the Forum to promote my paid service.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message).toBe("Thanks for talking.")
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it("repairs a questionless active reply instead of ending the conversation", async () => {
    createMock
      .mockResolvedValueOnce(toolReply("That sounds like a thoughtful way to share music.", false))
      .mockResolvedValueOnce(toolReply(
        "That sounds like a thoughtful way to share music. What kind of exchanges would you enjoy there?",
        false,
      ))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "I share playlists with friends.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("active")
    expect(body.message).toContain("What kind of exchanges would you enjoy there?")
    expect(state.sessionUpdates).toEqual([])
    expect(createMock).toHaveBeenCalledTimes(2)
  })

  it("does not save or close if questionless-reply repair fails", async () => {
    createMock
      .mockResolvedValueOnce(toolReply("That sounds interesting.", false))
      .mockResolvedValueOnce(toolReply("That sounds interesting.", false))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "I share playlists with friends.", applicant,
    })
    expect(response.status).toBe(503)
    expect(state.inserted).toEqual([])
    expect(state.sessionUpdates).toEqual([])
  })

  function priorAnswers(count: number) {
    state.history.push(...Array.from({ length: count }, (_, index) => ({
      id: `user-${index}`, role: "user", content: "I enjoy sharing music.", metadata: {},
    })))
  }
  const nineTurnContext = { ...context, settings: { applicationExperience: { max_turns: 9 } } } as ProjectContext

  it("keeps an ordinary conversation open before the soft close", async () => {
    priorAnswers(SOFT_CLOSE_ANSWERS - 2)
    createMock.mockResolvedValueOnce(toolReply("That community sounds close. What keeps you involved?", false))
    const response = await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "We still meet to hear new music.", applicant,
    })
    expect((await response.json()).status).toBe("active")
    expect(state.sessionUpdates).toEqual([])
  })

  it("tells Groucho to wrap up from the wrap-up answer onwards", async () => {
    priorAnswers(WRAP_UP_ANSWERS - 1)
    createMock.mockResolvedValueOnce(toolReply("That community sounds close. What keeps you involved?", false))
    await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "We still meet to hear new music.", applicant,
    })
    expect(createMock.mock.calls[0][0].system).toContain("The conversation is ready to wrap up.")
  })

  it("closes at the soft limit with the reply's own reflection and one model call", async () => {
    priorAnswers(SOFT_CLOSE_ANSWERS - 1)
    createMock.mockResolvedValueOnce(toolReply("You have built a generous ritual around sharing music. What would you share next?", false))
    const response = await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "We still meet to hear new music.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message.startsWith("You have built a generous ritual around sharing music.\n\n")).toBe(true)
    expect(body.message).not.toContain("?")
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it("answers an applicant question at the soft limit instead of closing", async () => {
    priorAnswers(SOFT_CLOSE_ANSWERS - 1)
    createMock.mockResolvedValueOnce(toolReply("Swaps can be shared as links. What would you share first?", false))
    const response = await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "Can I share links to unreleased demos?", applicant,
    })
    expect((await response.json()).status).toBe("active")
  })

  it("closes at the emergency limit without a repair call", async () => {
    priorAnswers(11)
    createMock.mockResolvedValueOnce(toolReply("What would you share next?", false))
    const response = await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "We still meet to hear new music.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message).not.toContain("?")
    expect(body.message).not.toContain("What would you share next")
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it("keeps decision language out of the closing acknowledgment", () => {
    expect(conversationalClosing("You would be a great fit here.", "Thanks for talking."))
      .toBe("Thanks for talking.")
    expect(conversationalClosing(
      "Sharing songs with friends sounds like a good way to stay connected. I think we have enough to move forward.",
      "Thanks for talking.",
    )).toBe("Sharing songs with friends sounds like a good way to stay connected.\n\nThanks for talking.")
    expect(conversationalClosing(
      "I hear you—you're looking for access to an audience. There's no space for that kind of outreach.",
      "Thanks for talking.",
    )).toBe("I hear you—you're looking for access to an audience.\n\nThanks for talking.")
    expect(conversationalClosing(
      "I appreciate the directness. You plan to use Forum replies to bring people to your service.",
      "Thanks for talking.",
    )).toBe("You plan to use Forum replies to bring people to your service.\n\nThanks for talking.")
  })

  it("gives a concrete closing rule without exposing the answer count", () => {
    const prompt = colorsThinConversationPrompt({ objective: "Forum membership", turnCount: 5, mediaCatalog: [] })
    expect(prompt).toContain("Most conversations should close after 3 to 5 applicant answers")
    expect(prompt).toContain("Never mention numbers, turns, stages")
    expect(prompt).not.toContain("This is answer")
    expect(prompt).not.toContain("Having enough material for a useful report means you may close, not that you should")
  })

  it("streams the reply, cut at its first question, when the turn cannot be force-closed", async () => {
    const reply = "Sunday swaps sound like careful listening. What would you share first? Or something else?"
    streamMock.mockReturnValueOnce(streamedToolReply(reply, false))
    const deltas: string[] = []
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "I swap drafts with two friends.", applicant,
      onReplyDelta: text => deltas.push(text),
    })
    const body = await response.json()
    expect(body.status).toBe("active")
    expect(createMock).not.toHaveBeenCalled()
    expect(deltas.length).toBeGreaterThan(3)
    expect(deltas.every((text, index) => index === 0 || text.startsWith(deltas[index - 1]))).toBe(true)
    expect(deltas.at(-1)).toBe("Sunday swaps sound like careful listening. What would you share first?")
    expect(body.message).toBe(deltas.at(-1))
  })

  it("does not stream a turn the runtime may force closed", async () => {
    priorAnswers(SOFT_CLOSE_ANSWERS - 1)
    createMock.mockResolvedValueOnce(toolReply("You have built a generous ritual around sharing music. What next?", false))
    const deltas: string[] = []
    const response = await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "We still meet to hear new music.", applicant,
      onReplyDelta: text => deltas.push(text),
    })
    expect((await response.json()).status).toBe("completed")
    expect(streamMock).not.toHaveBeenCalled()
    expect(deltas).toEqual([])
  })

  it("uses a tester-selected model for the turn", async () => {
    createMock.mockResolvedValueOnce(toolReply("Sharing playlists sounds sociable. Who do you share with?", false))
    await postColorsThinConversation({
      context, sessionId: "session-1", message: "I share playlists.", applicant, modelOverride: "claude-haiku-4-5-20251001",
    })
    expect(createMock.mock.calls[0][0].model).toBe("claude-haiku-4-5-20251001")
    expect(createMock.mock.calls[0][0].tool_choice).toEqual({ type: "tool", name: "groucho_converse" })
    expect(state.inserted.find(row => row.role === "assistant")?.metadata?.conversation_model).toBe("claude-haiku-4-5-20251001")
  })

  it("asks Sonnet 5.5 for structured JSON instead of a forced tool and reads it back", async () => {
    createMock.mockResolvedValueOnce(jsonReply("Sharing playlists sounds sociable. Who do you share with?", false))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "I share playlists.", applicant, modelOverride: "claude-sonnet-5-5",
    })
    const request = createMock.mock.calls[0][0]
    expect(request.tools).toBeUndefined()
    expect(request.tool_choice).toBeUndefined()
    expect(request.output_config.format.type).toBe("json_schema")
    expect(request.output_config.format.schema.additionalProperties).toBe(false)
    expect(JSON.stringify(request.output_config.format.schema)).not.toContain("maxItems")
    const body = await response.json()
    expect(body.status).toBe("active")
    expect(body.message).toBe("Sharing playlists sounds sociable. Who do you share with?")
  })

  it("streams structured JSON output from Sonnet 5.5", async () => {
    streamMock.mockReturnValueOnce(streamedJsonReply("Sharing playlists sounds sociable. Who do you share with?", false))
    const deltas: string[] = []
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "I share playlists.", applicant, modelOverride: "claude-sonnet-5-5",
      onReplyDelta: text => deltas.push(text),
    })
    expect((await response.json()).status).toBe("active")
    expect(deltas.length).toBeGreaterThan(3)
    expect(deltas.at(-1)).toBe("Sharing playlists sounds sociable. Who do you share with?")
  })

  it("reads the reply out of partial JSON", () => {
    expect(partialReplyFromJson('{"rep')).toBeUndefined()
    expect(partialReplyFromJson('{"reply":"Sunday sw')).toBe("Sunday sw")
    expect(partialReplyFromJson('{"reply":"She said \\"hi')).toBe('She said "hi')
    expect(partialReplyFromJson('{"reply":"a\\')).toBe("a")
    expect(partialReplyFromJson('{"reply":"done.","close":true}')).toBe("done.")
  })

  it("queues the completion pipeline when a conversation closes", async () => {
    priorAnswers(SOFT_CLOSE_ANSWERS - 1)
    createMock.mockResolvedValueOnce(toolReply("You have built a generous ritual around sharing music. What next?", false))
    await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "We still meet to hear new music.", applicant, likelyBot: true,
    })
    expect(queueMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: "org-1", projectId: "project-1", likelyBot: true }))
  })

  it("leaves completion to the caller when it is switched off, as the demo does", async () => {
    priorAnswers(SOFT_CLOSE_ANSWERS - 1)
    createMock.mockResolvedValueOnce(toolReply("You have built a generous ritual around sharing music. What next?", false))
    await postColorsThinConversation({
      context: nineTurnContext, sessionId: "session-1", message: "We still meet to hear new music.", applicant, runCompletion: false,
    })
    expect(queueMock).not.toHaveBeenCalled()
  })

  it("does not queue completion while the conversation continues", async () => {
    createMock.mockResolvedValueOnce(toolReply("Sharing playlists sounds sociable. Who do you share with?", false))
    await postColorsThinConversation({ context, sessionId: "session-1", message: "I share playlists.", applicant })
    expect(queueMock).not.toHaveBeenCalled()
  })

  it("accepts a later API turn that omits the applicant", async () => {
    createMock.mockResolvedValueOnce(toolReply("Sharing playlists sounds sociable. Who do you share with?", false))
    const response = await postColorsThinConversation({ context, sessionId: "session-1", message: "I share playlists." })
    expect((await response.json()).status).toBe("active")
  })
})
