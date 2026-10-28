import { beforeEach, describe, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), order: vi.fn(), limit: vi.fn(), update: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabase: db }))
vi.mock("@/lib/admin-actor", () => ({ resolveAdminActor: vi.fn() }))
vi.mock("@/lib/application-invitations", () => ({ createApplicationInvitation: vi.fn(), resolveApplicationInvitation: vi.fn() }))
vi.mock("@/lib/org-access", () => ({ requireOrgAdmin: vi.fn(), requireOrgMember: vi.fn(), unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }) }))
vi.mock("@/lib/project-resolution", () => ({ resolveProjectContext: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ ok: true })) }))
import { resolveAdminActor } from "@/lib/admin-actor"
import { createApplicationInvitation, resolveApplicationInvitation } from "@/lib/application-invitations"
import { requireOrgAdmin, requireOrgMember } from "@/lib/org-access"
import { resolveProjectContext } from "@/lib/project-resolution"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { POST, DELETE, GET } from "@/app/api/admin/organisations/[orgId]/projects/[projectId]/application-invitations/route"
import { POST as resolve } from "@/app/v1/application-invitations/resolve/route"
const context = { params: Promise.resolve({ orgId: "org", projectId: "project" }) }
const request = (body: unknown, origin = "https://groucho.test") => new Request("https://groucho.test/api/admin", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  for (const method of ["from", "select", "eq", "order", "update"] as const) db[method].mockReturnValue(db)
  db.maybeSingle.mockResolvedValue({ data: { settings: { application_invitation_required: true } }, error: null })
  db.limit.mockResolvedValue({ data: [], error: null })
  vi.mocked(resolveAdminActor).mockResolvedValue({ kind: "member", userId: "reviewer", email: "reviewer@example.test" })
  vi.mocked(requireOrgAdmin).mockResolvedValue(null); vi.mocked(requireOrgMember).mockResolvedValue(null)
  vi.mocked(createApplicationInvitation).mockResolvedValue({ invitation: { id: "invite" }, token: "private-token" } as never)
})
describe("application invitation permissions", () => {
  it("rejects cross-origin creation and revocation", async () => {
    expect((await POST(request({}, "https://evil.test"), context)).status).toBe(403)
    expect((await DELETE(request({}, "https://evil.test"), context)).status).toBe(403)
    expect(db.from).not.toHaveBeenCalled()
  })
  it("requires authentication and organisation admin before issuing or revoking invitations", async () => {
    vi.mocked(resolveAdminActor).mockResolvedValueOnce(null)
    expect((await POST(request({}), context)).status).toBe(401)
    vi.mocked(requireOrgAdmin).mockResolvedValue(Response.json({}, { status: 403 }) as never)
    expect((await POST(request({}), context)).status).toBe(403)
    expect((await DELETE(request({ id: "someone-elses-invite" }), context)).status).toBe(403)
    expect(db.from).not.toHaveBeenCalled(); expect(createApplicationInvitation).not.toHaveBeenCalled()
  })
  it("issues a private fragment link scoped to the authorised project and records the actor", async () => {
    const response = await POST(request({ email: "invited@example.test", audience: "community" }), context)
    expect(response.status).toBe(201)
    expect(db.eq).toHaveBeenCalledWith("organisation_id", "org")
    expect(db.eq).toHaveBeenCalledWith("id", "project")
    expect(createApplicationInvitation).toHaveBeenCalledWith(expect.objectContaining({ organisationId: "org", projectId: "project", actorUserId: "reviewer", email: "invited@example.test" }))
    const result = await response.json()
    expect(new URL(result.url).hash).toBe("#invite=private-token")
    expect(new URL(result.url).search).toBe("")
  })
  it("rejects projects without invitation-only mode and malformed recipients", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: { settings: {} }, error: null })
    expect((await POST(request({ email: "invited@example.test", audience: "artist" }), context)).status).toBe(409)
    expect((await POST(request({ email: "invalid", audience: "artist" }), context)).status).toBe(400)
    expect(createApplicationInvitation).not.toHaveBeenCalled()
  })
  it("scopes revocation and listing to the current organisation and project, without exposing hashes", async () => {
    await DELETE(request({ id: "invite" }), context)
    expect(db.eq).toHaveBeenCalledWith("organisation_id", "org")
    expect(db.eq).toHaveBeenCalledWith("project_id", "project")
    expect(db.eq).toHaveBeenCalledWith("id", "invite")
    vi.clearAllMocks()
    for (const method of ["from", "select", "eq", "order"] as const) db[method].mockReturnValue(db)
    db.maybeSingle.mockResolvedValue({ data: { settings: { application_invitation_required: true } }, error: null })
    db.limit.mockResolvedValue({ data: [], error: null })
    expect((await GET(request({}), context)).status).toBe(200)
    expect(db.select.mock.calls.at(-1)?.[0]).not.toMatch(/token|session_key/)
  })
  it("does not let anonymous fallback project resolution validate an invitation", async () => {
    vi.mocked(resolveProjectContext).mockResolvedValue({ ok: true, context: { organisationId: "org", projectId: "project", apiKeyId: null, settings: normalizeProjectSettings({}) } })
    expect((await resolve(request({ token: "secret" }))).status).toBe(401)
    expect(resolveApplicationInvitation).not.toHaveBeenCalled()
  })
  it("uses the API key's project and rejects expired or revoked invitations", async () => {
    vi.mocked(resolveProjectContext).mockResolvedValue({ ok: true, context: { organisationId: "org", projectId: "project", apiKeyId: "key", settings: normalizeProjectSettings({}) } })
    vi.mocked(resolveApplicationInvitation).mockResolvedValue(null)
    expect((await resolve(request({ token: "expired", projectId: "other-project" }))).status).toBe(403)
    expect(resolveApplicationInvitation).toHaveBeenCalledWith("project", "expired")
  })
})
