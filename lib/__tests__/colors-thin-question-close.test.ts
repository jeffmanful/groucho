import { beforeEach, describe, expect, it, vi } from "vitest"

const { createMock, state } = vi.hoisted(() => ({
  createMock: vi.fn(),
  state: {
    inserted: [] as Array<{ role: string; content: string }>,
    sessionUpdates: [] as Array<{ status: string }>,
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
        order: async () => ({ data: [{
          id: "opening-1", role: "assistant", content: "Why would you join?",
          metadata: { conversation_engine: "colors_thin_pilot_v1" },
        }], error: null }),
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

import { postColorsThinConversation } from "@/lib/colors-thin-conversation"
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

  it("still closes after an ordinary answer without a question", async () => {
    createMock.mockResolvedValueOnce(toolReply("It was good talking with you.", true))
    const response = await postColorsThinConversation({
      context, sessionId: "session-1", message: "I would like to talk about music here.", applicant,
    })
    const body = await response.json()
    expect(body.status).toBe("completed")
    expect(body.message).toBe("Thanks for talking.")
    expect(state.sessionUpdates).toEqual([{ status: "completed" }])
  })
})
