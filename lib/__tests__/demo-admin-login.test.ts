import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  managed: vi.fn(),
  legacy: vi.fn(),
}))
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseServerConfigured: () => true,
  createSupabaseServerClient: async () => ({ auth }),
}))
vi.mock("@/lib/platform-admin-access", () => ({
  hasManagedPlatformAccess: auth.managed,
  legacyPlatformEnabled: auth.legacy,
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }) }))

import { POST } from "@/app/api/auth/login/route"
import { DEMO_AUTH_COOKIE, demoSession, issueDemoToken, verifyDemoToken } from "@/lib/colors-demo-token"
import { proxy } from "@/proxy"

const email = "admin@example.com"
const user = { id: "admin-id", email, email_confirmed_at: "2026-01-01" }
const request = (demo = true, extra = {}) => new NextRequest("https://example.test/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password: "existing-password", demo, ...extra }),
})

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-only-secret")
  vi.stubEnv("ALLOWED_EMAILS", email)
  vi.stubEnv("ADMIN_PASSWORD", "existing-password")
  vi.stubEnv("COLORS_DEMO_EXTRA_TESTERS", "{}")
  auth.managed.mockResolvedValue(false)
  auth.legacy.mockResolvedValue(true)
  auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Invalid credentials" } })
})
afterEach(() => vi.unstubAllEnvs())

describe("platform administrator demo sign-in", () => {
  it("gives a verified core administrator a demo session that opens every demo", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { ...user, app_metadata: { groucho_role: "platform_admin" } } }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ role: "colors_demo_tester" })
    const token = response.cookies.get(DEMO_AUTH_COOKIE)?.value
    expect(await verifyDemoToken(token, "tester")).toMatchObject({ email, access: "platform_admin" })
    for (const path of ["/demos/ticket-access", "/demos/consumer-drop", "/demo/colors", "/api/demo/colors/project"]) {
      const pageRequest = new NextRequest(`https://example.test${path}`)
      pageRequest.cookies.set(DEMO_AUTH_COOKIE, token!)
      expect((await proxy(pageRequest)).headers.get("x-middleware-next")).toBe("1")
    }
    expect(await verifyDemoToken(`${token}x`, "tester")).toBeNull()
  })

  it("supports existing legacy administrator credentials without changing normal admin login", async () => {
    const demo = await POST(request())
    expect(demo.status).toBe(200)
    expect(demo.cookies.get("pe_auth")?.value).toBeTruthy()
    expect(await verifyDemoToken(demo.cookies.get(DEMO_AUTH_COOKIE)?.value, "tester"))
      .toMatchObject({ email, access: "platform_admin" })
    const admin = await POST(request(false))
    expect(await admin.json()).toEqual({ ok: true })
    expect(admin.cookies.get(DEMO_AUTH_COOKIE)).toBeUndefined()
  })

  it("accepts a confirmed managed administrator", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user }, error: null })
    auth.managed.mockResolvedValue(true)
    expect((await POST(request())).cookies.get(DEMO_AUTH_COOKIE)?.value).toBeTruthy()
    expect(auth.managed).toHaveBeenCalledWith(user.id, email)
  })

  it("does not grant demo access from user-editable metadata or client claims", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { ...user, user_metadata: { groucho_role: "platform_admin" } } }, error: null })
    const response = await POST(request(true, { access: "platform_admin", role: "platform_admin" }))
    expect(response.status).toBe(403)
    expect(response.cookies.get(DEMO_AUTH_COOKIE)).toBeUndefined()
  })

  it("rejects unconfirmed administrators and revoked legacy access", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: null, app_metadata: { groucho_role: "platform_admin" } } }, error: null })
    expect((await POST(request())).status).toBe(403)
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Invalid credentials" } })
    auth.legacy.mockResolvedValue(false)
    expect((await POST(request())).status).toBe(401)
  })

  it("keeps platform demo conversations bound to their tester and session", async () => {
    const tester = await issueDemoToken({ kind: "tester", email, access: "platform_admin", issuedAt: Date.now() })
    const session = await issueDemoToken({ kind: "session", email, access: "platform_admin", sessionId: "session-one", issuedAt: Date.now() })
    const req = new NextRequest("https://example.test/api/demo/colors/messages")
    req.cookies.set(DEMO_AUTH_COOKIE, tester!)
    req.cookies.set("colors_demo_session", session!)
    expect(await demoSession(req, "session-one")).toMatchObject({ email })
    expect(await demoSession(req, "session-two")).toBeNull()
    const unsignedScope = await issueDemoToken({ kind: "tester", email, issuedAt: Date.now() })
    expect(await verifyDemoToken(unsignedScope!, "tester")).toBeNull()
  })
})
