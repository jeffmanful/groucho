import { beforeEach, describe, expect, it, vi } from "vitest"

const { createMock, state } = vi.hoisted(() => ({
  createMock: vi.fn(),
  state: {
    inserted: [] as Array<{ role: string; content: string }>,
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

function toolReply(reply: string, close: boolean) {
  return {
    stop_reason: "tool_use",
    usage: {},
    content: [{ type: "tool_use", name: "groucho_converse", input: {
      reply, close, boundary: "none", boundaryQuestion: "",
    } }],
  }
}

describe("thin pilot close after an applicant question", () => {
  beforeEach(() => {
    createMock.mockReset()
    state.inserted = []
    state.sessionUpdates = []
    state.history = [{
      id: "opening-1", role: "assistant", content: "Why would you join?",
      metadata: { conversation_engine: "colors_thin_pilot_v1" },
    }]
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
