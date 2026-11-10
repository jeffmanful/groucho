import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createHash } from "node:crypto"

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failTable: "",
  loseClaim: false,
  user: null as null | { id: string; email: string; email_confirmed_at?: string; app_metadata?: Record<string, unknown> },
  auth: { getUser: vi.fn(), signInWithPassword: vi.fn(), exchangeCodeForSession: vi.fn(), signOut: vi.fn(), signInWithOtp: vi.fn() },
}))
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | null = null
  let added: Row | null = null
  let cap = Infinity
  const result = () => {
    if (state.failTable === table) return { data: null, error: { message: "offline" } }
    const all = state.tables[table] ??= []
    if (added) { all.push(added); added = null }
    let rows = all.filter(row => filters.every(f => f(row))).slice(0, cap)
    if (patch && state.loseClaim && table === "invitations") rows = []
    if (patch) rows.forEach(row => Object.assign(row, patch))
    return { data: rows, error: null }
  }
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
    gt: (key: string, value: string) => { filters.push(row => String(row[key]) > value); return q },
    limit: (n: number) => { cap = n; return q },
    update: (value: Row) => { patch = value; return q },
    insert: (value: Row) => { added = value; return q },
    maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null } },
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return q
} } }))
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseServerConfigured: () => true,
  createSupabaseServerClient: async () => ({ auth: state.auth }),
}))
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: state.auth }) }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }) }))

import { dashboardAccess, canSignInToDashboard } from "@/lib/dashboard-access"
import { resolveAdminActor } from "@/lib/admin-actor"
import { POST as login } from "@/app/api/auth/login/route"
import { GET as callback } from "@/app/api/auth/callback/route"
import { POST as signup } from "@/app/api/organisations/signup/route"
import { POST as sendCode } from "@/app/api/invitations/send-code/route"
import { POST as accept } from "@/app/api/invitations/accept/route"
import { GET as getInvitation, POST as emailInvitation } from "@/app/api/admin/organisations/[orgId]/invitations/[invitationId]/route"
import { proxy } from "@/proxy"
const token = "a".repeat(64)
const origin = "https://admin.groucho.app"
const user = { id: "invited-user", email: "client@example.test", email_confirmed_at: "2026-01-01" }
const req = (path: string, body: unknown = {}) => new NextRequest(origin + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) })
const invitation = () => ({ id: "invite", organisation_id: "org", email: user.email, token, role: "member", expires_at: "2099-01-01", accepted_at: null })
beforeEach(() => {
  state.tables = { organisation_members: [], platform_admin_access: [], invitations: [] }
  state.failTable = ""; state.loseClaim = false; state.user = user
  state.auth.getUser.mockImplementation(async () => ({ data: { user: state.user }, error: null }))
  state.auth.signInWithPassword.mockImplementation(async () => ({ data: { user: state.user }, error: null }))
  state.auth.exchangeCodeForSession.mockResolvedValue({ error: null })
  state.auth.signOut.mockResolvedValue({ error: null })
  state.auth.signInWithOtp.mockResolvedValue({ error: null })
  vi.stubEnv("AUTH_SECRET", "test-only-secret"); vi.stubEnv("ALLOWED_EMAILS", "")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("invite-only dashboard grants", () => {
  it("emails the stored invitation and reuses the provider key on retry", async () => {
    const pending = invitation()
    state.tables.invitations.push(pending)
    state.tables.organisations = [{ id: "org", name: "Example Organisation" }]
    const membership = { user_id: user.id, organisation_id: "org", role: "member" }
    state.tables.organisation_members.push(membership)
    vi.stubEnv("RESEND_API_KEY", "test-key")
    vi.stubEnv("GROUCHO_INVITATION_FROM_EMAIL", "invites@example.test")
    vi.stubEnv("GROUCHO_INVITATION_BASE_URL", "https://dashboard.example.test")
    const deliver = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: "message" }))
    vi.stubGlobal("fetch", deliver)
    const send = (requestOrigin = origin) =>
      emailInvitation(new NextRequest(origin + "/api/admin/organisations/org/invitations/invite", {
        method: "POST",
        headers: { origin: requestOrigin, "Idempotency-Key": "cb733380-9d84-4bf5-a851-e602cc3160bd" },
      }), { params: Promise.resolve({ orgId: "org", invitationId: "invite" }) })

    expect((await send()).status).toBe(403)
    membership.role = "admin"
    expect((await send("https://other.example.test")).status).toBe(403)
    expect(deliver).not.toHaveBeenCalled()
    expect((await send()).status).toBe(502)
    expect((await send()).status).toBe(200)
    const [url, options] = deliver.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(JSON.parse(String(options?.body))).toMatchObject({
      to: [pending.email],
      text: expect.stringContaining(`https://dashboard.example.test/invite/${token}`),
    })
    expect(deliver.mock.calls[1][1]?.headers).toEqual(options?.headers)
    Object.assign(pending, { accepted_at: "2026-01-01" })
    expect((await send()).status).toBe(404)
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it("returns the original pending invitation token only to authorised administrators", async () => {
    const pending = invitation()
    state.tables.invitations.push(pending)
    const membership = { user_id: user.id, organisation_id: "org", role: "member" }
    state.tables.organisation_members.push(membership)
    const getLink = (orgId = "org") =>
      getInvitation(new NextRequest(origin + `/api/admin/organisations/${orgId}/invitations/invite`), {
        params: Promise.resolve({ orgId, invitationId: "invite" }),
      })

    expect((await getLink()).status).toBe(403)
    membership.role = "admin"
    const response = await getLink()
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.json()).toEqual({ email: pending.email, token })

    state.tables.organisation_members.push({ ...membership, organisation_id: "other-org" })
    expect((await getLink("other-org")).status).toBe(404)
    Object.assign(pending, { role: "owner" })
    expect((await getLink()).status).toBe(403)
    membership.role = "owner"
    expect((await getLink()).status).toBe(200)

    Object.assign(pending, { accepted_at: "2026-01-01" })
    expect((await getLink()).status).toBe(404)
    Object.assign(pending, { accepted_at: null, expires_at: "2000-01-01" })
    expect((await getLink()).status).toBe(404)
    state.tables.invitations = []
    expect((await getLink()).status).toBe(404)
  })

  it("denies a verified identity without a grant, including user-editable role claims", async () => {
    expect(await dashboardAccess({ ...user, user_metadata: { groucho_role: "platform_admin" } } as typeof user)).toBeNull()
    expect(await resolveAdminActor()).toBeNull()
    expect(await canSignInToDashboard(user, "/admin")).toBe(false)
    expect((await proxy(new NextRequest(origin + "/api/admin/session"))).status).toBe(401)
  })
  it("preserves core, managed and organisation access while rejecting unverified identities", async () => {
    expect(await dashboardAccess({ ...user, app_metadata: { groucho_role: "platform_admin" } })).toBe("platform")
    state.tables.platform_admin_access.push({ id: "grant", user_id: user.id, email: user.email, status: "active" })
    expect(await dashboardAccess(user)).toBe("platform")
    state.tables.platform_admin_access[0].status = "revoked"
    expect(await dashboardAccess(user)).toBeNull()
    state.tables.organisation_members.push({ id: "membership", user_id: user.id, role: "member" })
    expect(await dashboardAccess(user)).toBe("member")
    expect(await resolveAdminActor()).toMatchObject({ kind: "member", userId: user.id })
    expect((await proxy(new NextRequest(origin + "/admin"))).headers.get("x-middleware-next")).toBe("1")
    expect(await dashboardAccess({ ...user, email_confirmed_at: null })).toBeNull()
  })
  it("fails closed when membership storage is unavailable", async () => {
    state.failTable = "organisation_members"
    expect(await dashboardAccess(user)).toBeNull()
  })
  it("allows only the matching live invitation destination before acceptance", async () => {
    state.tables.invitations.push(invitation())
    expect(await canSignInToDashboard(user, `/invite/${token}`)).toBe(true)
    expect(await dashboardAccess(user)).toBeNull()
    for (const path of ["/admin", `https://evil.test/invite/${token}`, `/invite/${token}/../other`]) {
      expect(await canSignInToDashboard(user, path)).toBe(false)
    }
    expect(await canSignInToDashboard({ ...user, email: "other@example.test" }, `/invite/${token}`)).toBe(false)
    state.tables.invitations[0].expires_at = "2000-01-01"
    expect(await canSignInToDashboard(user, `/invite/${token}`)).toBe(false)
    state.tables.invitations[0].expires_at = "2099-01-01"; state.tables.invitations[0].accepted_at = "2026-01-01"
    expect(await canSignInToDashboard(user, `/invite/${token}`)).toBe(false)
  })
  it("allows matching pending administrator invitations without granting admin rights", async () => {
    state.tables.platform_admin_access.push({ email: user.email, token_hash: createHash("sha256").update(token).digest("hex"), status: "pending", expires_at: "2099-01-01" })
    expect(await canSignInToDashboard(user, `/invite/admin/${token}`)).toBe(true)
    expect(await dashboardAccess(user)).toBeNull()
    state.tables.platform_admin_access[0].status = "revoked"
    expect(await canSignInToDashboard(user, `/invite/admin/${token}`)).toBe(false)
  })
})

describe("sign-in and signup routes", () => {
  it("permanently denies direct public organisation creation", async () => {
    expect((await signup()).status).toBe(403)
    expect(state.auth.getUser).not.toHaveBeenCalled()
  })
  it("rejects and signs out uninvited password and OAuth identities", async () => {
    expect((await login(req("/api/auth/login", { email: user.email, password: "secret" }))).status).toBe(403)
    const result = await callback(new NextRequest(origin + "/api/auth/callback?code=test"))
    expect(result.headers.get("location")).toBe(origin + "/login?error=invitation_required")
    expect(state.auth.signOut).toHaveBeenCalledWith({ scope: "local" })
  })
  it("keeps shared login working for an invitee and for existing clients", async () => {
    state.tables.invitations.push(invitation())
    expect((await login(req("/api/auth/login", { email: user.email, password: "secret", next: `/invite/${token}` }))).status).toBe(200)
    const result = await callback(new NextRequest(origin + `/api/auth/callback?code=test&next=${encodeURIComponent(`/invite/${token}`)}`))
    expect(result.headers.get("location")).toBe(origin + `/invite/${token}`)
    state.tables.organisation_members.push({ id: "membership", user_id: user.id, role: "admin" })
    expect((await login(req("/api/auth/login", { email: user.email, password: "secret" }))).status).toBe(200)
  })
})

describe("organisation invitation enforcement", () => {
  it("never sends email for invalid, used, expired or revoked invitation tokens", async () => {
    for (const row of [null, { ...invitation(), accepted_at: "2026-01-01" }, { ...invitation(), expires_at: "2000-01-01" }]) {
      state.tables.invitations = row ? [row] : []
      expect((await sendCode(req("/api/invitations/send-code", { token }))).status).toBe(410)
    }
    expect(state.auth.signInWithOtp).not.toHaveBeenCalled()
  })
  it("derives the email recipient and callback from a live invitation", async () => {
    state.tables.invitations.push(invitation())
    expect((await sendCode(req("/api/invitations/send-code", { token, email: "attacker@example.test" }))).status).toBe(200)
    expect(state.auth.signInWithOtp).toHaveBeenCalledWith({ email: user.email, options: { shouldCreateUser: true, emailRedirectTo: origin + `/api/auth/callback?next=%2Finvite%2F${token}` } })
  })
  it("requires the verified invited identity and refuses cross-origin acceptance", async () => {
    state.tables.invitations.push(invitation())
    state.user = { ...user, email: "other@example.test" }
    expect((await accept(req("/api/invitations/accept", { token }))).status).toBe(403)
    state.user = { ...user, email_confirmed_at: undefined }
    expect((await accept(req("/api/invitations/accept", { token }))).status).toBe(401)
    const foreign = req("/api/invitations/accept", { token }); foreign.headers.set("origin", "https://evil.test")
    expect((await accept(foreign)).status).toBe(403)
    expect(state.tables.organisation_members).toEqual([])
  })
  it("consumes an invitation once before granting only its server-stored organisation and role", async () => {
    state.tables.invitations.push(invitation())
    expect((await accept(req("/api/invitations/accept", { token, role: "owner", organisationId: "other-org" }))).status).toBe(200)
    expect(state.tables.organisation_members).toMatchObject([{ organisation_id: "org", user_id: user.id, role: "member" }])
    expect((await accept(req("/api/invitations/accept", { token }))).status).toBe(410)
    expect(await dashboardAccess(user)).toBe("member")
  })
  it("does not grant access if an invitation loses its conditional claim", async () => {
    state.tables.invitations.push(invitation()); state.loseClaim = true
    expect((await accept(req("/api/invitations/accept", { token }))).status).toBe(410)
    expect(state.tables.organisation_members).toEqual([])
  })
})
