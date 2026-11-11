import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  actor: { kind: "member", userId: "user", email: "tester@example.test" } as null | { kind: "member"; userId: string; email: string },
  deny: false,
  allowed: true,
  persona: { id: "persona", name: "Host", version: 2, prompt: "You are Host. Follow the visitor’s concrete musical interests.", is_active: true },
  session: null as null | Record<string, unknown>,
  start: vi.fn(),
  turn: vi.fn(),
}))
vi.mock("@/lib/admin-actor", () => ({ resolveAdminActor: async () => mocks.actor }))
vi.mock("@/lib/org-access", () => ({
  requireOrgMember: async () => mocks.deny ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) : null,
  unauthorized: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}))
vi.mock("@/lib/persona-ownership", () => ({
  loadPersona: async () => mocks.persona,
  personaUsableByOrganisation: async () => mocks.allowed,
}))
vi.mock("@/lib/colors-demo-access", () => ({
  colorsDemoProject: async () => ({
    context: { organisationId: "colors", projectId: "forum", apiKeyId: null, settings: { raw: { conversation_engine: "colors_forum", application_invitation_required: true } } },
    option: { id: "forum", slug: "forum-application", name: "Forum Application" },
  }),
}))
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: mocks.session, error: null }) }
  return q
} } }))
vi.mock("@/lib/start-gatekeeper-session", () => ({ startGatekeeperSession: mocks.start }))
vi.mock("@/lib/colors-thin-conversation", () => ({
  COLORS_THIN_PILOT_MARKER: "colors_thin_pilot_v1",
  postColorsThinConversation: mocks.turn,
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }) }))

import { resolvePersonaPreview, loadPersonaPreviewSession } from "@/lib/persona-preview"
import { GET, POST } from "@/app/api/admin/organisations/[orgId]/personas/[personaId]/preview/[action]/route"
import { colorsThinConversationPrompt } from "@/lib/colors-conversation-profile"

const sessionId = "00000000-0000-4000-8000-000000000001"
const context = (action: string) => ({ params: Promise.resolve({ orgId: "colors", personaId: "persona", action }) })
const request = (action: string, extra = {}) => new NextRequest("https://example.test/preview/" + action, {
  method: "POST", headers: { origin: "https://example.test", "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, previewVersion: 2, applicant: { email: "tester@example.test" }, message: "I organise listening nights.", ...extra }),
})
beforeEach(() => {
  mocks.actor = { kind: "member", userId: "user", email: "tester@example.test" }
  mocks.deny = false
  mocks.allowed = true
  mocks.persona.is_active = true
  mocks.persona.prompt = "You are Host. Follow the visitor’s concrete musical interests."
  mocks.session = null
  mocks.start.mockReset()
  mocks.turn.mockReset()
})

describe("saved persona preview", () => {
  it("requires current membership, persona visibility and an active saved prompt", async () => {
    mocks.actor = null
    expect((await resolvePersonaPreview("colors", "persona") as NextResponse).status).toBe(401)
    mocks.actor = { kind: "member", userId: "user", email: "tester@example.test" }
    mocks.deny = true
    expect((await resolvePersonaPreview("colors", "persona") as NextResponse).status).toBe(403)
    mocks.deny = false
    expect((await resolvePersonaPreview("other-org", "persona") as NextResponse).status).toBe(404)
    mocks.allowed = false
    expect((await resolvePersonaPreview("colors", "persona") as NextResponse).status).toBe(404)
    mocks.allowed = true
    mocks.persona.is_active = false
    expect((await resolvePersonaPreview("colors", "persona") as NextResponse).status).toBe(409)
  })

  it("pins the saved prompt at start and uses it on subsequent turns after edits", async () => {
    mocks.start.mockImplementation(async (input) => {
      mocks.session = { id: "row", status: "active", profile: { persona_preview: input.personaPreview } }
      return NextResponse.json({ message: "What brings you here?", status: "active" })
    })
    expect((await POST(request("start"), context("start"))).status).toBe(200)
    const started = mocks.start.mock.calls[0][0]
    expect(started.personaId).toBe("persona")
    expect(started.projectSettings.raw.application_invitation_required).toBe(false)
    expect(started).toMatchObject({ demoSession: true, personaPreview: { actor: "member:user", version: 2 } })
    const saved = mocks.persona.prompt
    mocks.persona.prompt = "A later edit"
    mocks.turn.mockResolvedValue(NextResponse.json({ message: "What do you enjoy sharing at those nights?", status: "active" }))
    expect((await POST(request("message"), context("message"))).status).toBe(200)
    expect(mocks.turn).toHaveBeenCalledWith(expect.objectContaining({ personaPrompt: saved, runCompletion: false }))
    const preview = await resolvePersonaPreview("colors", "persona")
    if (preview instanceof NextResponse) throw new Error("Expected authorised preview")
    mocks.session!.profile = { persona_preview: { ...started.personaPreview, actor: "member:someone-else" } }
    expect((await loadPersonaPreviewSession(preview, sessionId) as NextResponse).status).toBe(404)
    mocks.session!.profile = { persona_preview: { ...started.personaPreview, id: "another-persona" } }
    expect((await POST(request("message"), context("message"))).status).toBe(404)
    expect(mocks.turn).toHaveBeenCalledTimes(1)
  })

  it("rejects public sessions and cross-origin starts, and exposes no preview report action", async () => {
    mocks.session = { id: "public", profile: null }
    expect((await POST(request("start"), context("start"))).status).toBe(404)
    expect(mocks.start).not.toHaveBeenCalled()
    const req = request("start")
    req.headers.set("origin", "https://elsewhere.test")
    expect((await POST(req, context("start"))).status).toBe(403)
    expect((await GET(new NextRequest("https://example.test/preview/report"), context("report"))).status).toBe(404)
  })

  it("requires restarting if the saved persona changed before a new session starts", async () => {
    expect((await POST(request("start", { previewVersion: 1 }), context("start"))).status).toBe(409)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it("composes the selected character with COLORS conversation guidance", () => {
    const prompt = colorsThinConversationPrompt({
      objective: "Welcome the visitor", turnCount: 1, mediaCatalog: [],
      personaPrompt: "You are Avery, an observant music host.",
    })
    expect(prompt).toMatch(/^You are Avery, an observant music host./)
    expect(prompt).toContain("Current project objective: Welcome the visitor")
    expect(prompt).toContain("Speak as the selected persona")
    expect(prompt).toContain("A request to clarify or change topic deserves a direct response.")
  })
})
