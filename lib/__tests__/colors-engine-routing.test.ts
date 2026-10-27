import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  session: null as { id: string } | null,
  opening: null as { metadata: unknown } | null,
  start: vi.fn(),
  post: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const data = table === "sessions" ? mocks.session : mocks.opening
      const chain = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data, error: null }),
      }
      return chain
    },
  },
}))
vi.mock("@/lib/start-gatekeeper-session", () => ({ startGatekeeperSession: mocks.start }))
vi.mock("@/lib/colors-thin-conversation", () => ({ postColorsThinConversation: mocks.post }))

import { colorsEngineRoute, postColorsEngineTurn } from "@/lib/colors-engine-routing"
import { projectUsesColorsEngine } from "@/lib/colors-engine"
import type { ProjectContext } from "@/lib/project-resolution"

const colorsSettings = { project_type: "gatekeeper", conversation_engine: "colors_forum" }
const route = (rawSettings: unknown) => colorsEngineRoute({ projectId: "project-1", sessionId: "session-1", rawSettings })

describe("routing COLORS conversations to the newer engine", () => {
  beforeEach(() => {
    mocks.session = null
    mocks.opening = null
    mocks.start.mockReset()
    mocks.post.mockReset()
  })

  it("starts new sessions on configured projects on the newer engine", async () => {
    expect(await route(colorsSettings)).toBe("start-colors")
    expect(await route({ project_type: "gatekeeper" })).toBe("standard")
  })

  it("keeps each existing session on the engine it started with", async () => {
    mocks.session = { id: "internal-1" }
    mocks.opening = { metadata: { conversation_engine: "colors_thin_pilot_v1" } }
    expect(await route({ project_type: "gatekeeper" })).toBe("colors")
    mocks.opening = { metadata: { gatekeeper_bootstrap: true } }
    expect(await route(colorsSettings)).toBe("standard")
  })

  it("never runs completion for an API turn on a demo session", async () => {
    mocks.session = { id: "internal-1" }
    mocks.opening = { metadata: { conversation_engine: "colors_thin_pilot_v1", colors_demo_session: true } }
    expect(await route(colorsSettings)).toBe("colors-demo")
    mocks.post.mockResolvedValue(NextResponse.json({ status: "active" }))
    const context = { settings: { raw: colorsSettings } } as unknown as ProjectContext
    await postColorsEngineTurn({ route: "colors-demo", context, sessionId: "session-1", message: "Hello", likelyBot: false })
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({ runCompletion: false }))
    await postColorsEngineTurn({ route: "colors", context, sessionId: "session-1", message: "Hello", likelyBot: false })
    expect(mocks.post).toHaveBeenLastCalledWith(expect.objectContaining({ runCompletion: true }))
  })

  it("recognises the project setting only for the exact value", () => {
    expect(projectUsesColorsEngine(colorsSettings)).toBe(true)
    expect(projectUsesColorsEngine({ conversation_engine: "standard" })).toBe(false)
    expect(projectUsesColorsEngine(null)).toBe(false)
  })

  it("starts the session first when a client posts before calling start", async () => {
    mocks.start.mockResolvedValue(NextResponse.json({ status: "active" }))
    mocks.post.mockResolvedValue(NextResponse.json({ status: "active" }))
    const context = { organisationId: "org-1", projectId: "project-1", settings: { raw: colorsSettings } } as unknown as ProjectContext
    await postColorsEngineTurn({ route: "start-colors", context, sessionId: "session-1", message: "Hello", likelyBot: false, applicant: { email: "a@example.test" } })
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ conversationEngine: "colors_thin_pilot_v1", applicantIdentity: { email: "a@example.test" } }))
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1", message: "Hello", likelyBot: false }))
  })

  it("returns the start error without posting the message", async () => {
    mocks.start.mockResolvedValue(NextResponse.json({ error: "Applicant email is required" }, { status: 400 }))
    const context = { settings: { raw: colorsSettings } } as unknown as ProjectContext
    const response = await postColorsEngineTurn({ route: "start-colors", context, sessionId: "session-1", message: "Hello", likelyBot: false })
    expect(response.status).toBe(400)
    expect(mocks.post).not.toHaveBeenCalled()
  })
})
