import { beforeEach, describe, expect, it, vi } from "vitest"

const { createMock, state } = vi.hoisted(() => ({
  createMock: vi.fn(),
  state: {
    audience: "community",
    inserted: [] as Array<{ role: string; content: string; metadata?: Record<string, unknown> }>,
    sessionUpdates: [] as Array<{ status: string }>,
    history: [] as Array<{ id: string; role: string; content: string; metadata: Record<string, unknown> }>,
  },
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock }
  },
}))
vi.mock("@/lib/gatekeeper-models", () => ({ gatekeeperConversationModel: () => "test-model" }))
vi.mock("@/lib/llm-usage", () => ({ logLlmUsage: vi.fn() }))
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
  postColorsThinConversation,
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

describe("thin pilot close after an applicant question", () => {
  beforeEach(() => {
    createMock.mockReset()
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

  it("repairs a closing process claim before showing the final line", async () => {
    createMock
      .mockResolvedValueOnce(toolReply("I think we have enough to move forward.", true))
      .mockResolvedValueOnce(toolReply(
        "You were clear that you would use the Forum to direct readers to your promotion service.",
        true,
      ))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1",
      message: "I would use the Forum to promote my paid service.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message).toBe(
      "You were clear that you would use the Forum to direct readers to your promotion service.\n\nThanks for talking.",
    )
    expect(createMock).toHaveBeenCalledTimes(2)
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

  it("does not treat the configured nine-answer target as a forced close", async () => {
    state.history.push(...Array.from({ length: 8 }, (_, index) => ({
      id: `user-${index}`, role: "user", content: "I enjoy sharing music.", metadata: {},
    })))
    createMock.mockResolvedValueOnce(toolReply("That community sounds close. What keeps you involved?", false))
    const response = await postColorsThinConversation({
      context: { ...context, settings: { applicationExperience: { max_turns: 9 } } } as ProjectContext,
      sessionId: "session-1", message: "We still meet to hear new music.", applicant,
    })
    expect((await response.json()).status).toBe("active")
    expect(state.sessionUpdates).toEqual([])
  })

  it("repairs a question at the emergency limit into a conversational close", async () => {
    state.history.push(...Array.from({ length: 11 }, (_, index) => ({
      id: `user-${index}`, role: "user", content: "I enjoy sharing music.", metadata: {},
    })))
    createMock
      .mockResolvedValueOnce(toolReply("What would you share next?", false))
      .mockResolvedValueOnce(toolReply("You have built a generous ritual around sharing music.", true))
    const response = await postColorsThinConversation({
      context: { ...context, settings: { applicationExperience: { max_turns: 9 } } } as ProjectContext,
      sessionId: "session-1", message: "We still meet to hear new music.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message).toContain("You have built a generous ritual")
    expect(createMock).toHaveBeenCalledTimes(2)
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

  it("does not present report readiness or a five-answer target as a reason to stop", () => {
    const prompt = colorsThinConversationPrompt({ objective: "Forum membership", turnCount: 5, mediaCatalog: [] })
    expect(prompt).toContain("Having enough material for a useful report means you may close")
    expect(prompt).not.toContain("approximate 5-answer")
    expect(prompt).not.toContain("prefer a warm close")
  })
})
