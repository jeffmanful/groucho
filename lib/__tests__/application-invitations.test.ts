import { beforeEach, describe, expect, it, vi } from "vitest"
const db = vi.hoisted(() => {
  const chain = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), gt: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), single: vi.fn() }
  return { ...chain, from: vi.fn() }
})
vi.mock("@/lib/supabase", () => ({ supabase: db }))
import { createApplicationInvitation, invitationAllowsStart, invitationHash, resolveApplicationInvitation } from "@/lib/application-invitations"
const token = `gai_${"a".repeat(43)}`
const row = { id: "invite", email: "invited@example.test", name: null, audience: "community" as const, session_key: "assigned-session", expires_at: "2099-01-01T00:00:00Z" }
beforeEach(() => {
  vi.clearAllMocks()
  for (const method of ["from", "select", "eq", "is", "gt", "insert"] as const) db[method].mockReturnValue(db)
  db.maybeSingle.mockResolvedValue({ data: row, error: null })
  db.single.mockResolvedValue({ data: row, error: null })
})
describe("application invitations", () => {
  it("rejects malformed tokens before accessing the database", async () => {
    for (const bad of [undefined, null, 42, "gai_abc", "a".repeat(500)]) expect(await resolveApplicationInvitation("project", bad)).toBeNull()
    expect(db.from).not.toHaveBeenCalled()
  })
  it("scopes a hashed token by project, expiry and revocation", async () => {
    const resolved = await resolveApplicationInvitation("project", token)
    expect(db.eq).toHaveBeenCalledWith("project_id", "project")
    expect(db.eq).toHaveBeenCalledWith("token_hash", invitationHash(token))
    expect(db.is).toHaveBeenCalledWith("revoked_at", null)
    expect(db.gt).toHaveBeenCalledWith("expires_at", expect.any(String))
    expect(resolved).toMatchObject({ sessionId: "assigned-session", email: row.email })
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await resolveApplicationInvitation("another-project", token)).toBeNull()
  })
  it("fails closed on invitation service errors", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } })
    await expect(resolveApplicationInvitation("project", token)).rejects.toThrow("unavailable")
  })
  it("authorizes only the assigned session, email and audience, with complete intake", () => {
    const invitation = { id: "invite", email: row.email, name: null, audience: "community" as const, sessionId: "session", expiresAt: row.expires_at }
    const applicant = { email: row.email, details: { city: "London", country: "UK", occupation: "Student", ageRange: "25-34" } } as never
    expect(invitationAllowsStart(invitation, "session", applicant)).toBe(true)
    expect(invitationAllowsStart(invitation, "other-session", applicant)).toBe(false)
    expect(invitationAllowsStart(invitation, "session", { email: "someone-else@example.test" })).toBe(false)
    expect(invitationAllowsStart(invitation, "session", { email: row.email })).toBe(false)
    expect(invitationAllowsStart(null, "session", applicant)).toBe(false)
    expect(invitationAllowsStart({ ...invitation, audience: "artist" }, "session", applicant)).toBe(false)
  })
  it("stores only a random token hash and returns the private link token once", async () => {
    const created = await createApplicationInvitation({ organisationId: "org", projectId: "project", email: " INVITED@EXAMPLE.TEST ", audience: "artist", actorEmail: "reviewer@example.test", actorUserId: "reviewer" })
    expect(created.token).toMatch(/^gai_[A-Za-z0-9_-]{43}$/)
    const payload = db.insert.mock.calls[0][0]
    expect(payload).toMatchObject({ email: row.email, audience: "artist", token_hash: invitationHash(created.token), created_by_user_id: "reviewer" })
    expect(JSON.stringify(payload)).not.toContain(created.token)
    expect(new Date(payload.expires_at).getTime() - Date.now()).toBeGreaterThan(6.99 * 86400000)
  })
})
