import { afterEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { POST as login } from "@/app/api/auth/login/route"
import {
  DEMO_AUTH_COOKIE,
  demoPasswordMatches,
  issueDemoToken,
  verifyDemoToken,
} from "@/lib/colors-demo-token"
import { isAllowedPlatformEmail } from "@/lib/pe-auth"

const originalSecret = process.env.AUTH_SECRET
const originalEmail = process.env.COLORS_DEMO_TESTER_EMAIL
const originalPassword = process.env.COLORS_DEMO_PASSWORD
const originalAllowed = process.env.ALLOWED_EMAILS
const originalAdminPassword = process.env.ADMIN_PASSWORD

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
  if (originalEmail === undefined) delete process.env.COLORS_DEMO_TESTER_EMAIL
  else process.env.COLORS_DEMO_TESTER_EMAIL = originalEmail
  if (originalPassword === undefined) delete process.env.COLORS_DEMO_PASSWORD
  else process.env.COLORS_DEMO_PASSWORD = originalPassword
  if (originalAllowed === undefined) delete process.env.ALLOWED_EMAILS
  else process.env.ALLOWED_EMAILS = originalAllowed
  if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD
  else process.env.ADMIN_PASSWORD = originalAdminPassword
})

describe("COLORS demo access", () => {
  it("issues a role-scoped tester token only for the configured email", async () => {
    process.env.AUTH_SECRET = "test-only-secret"
    process.env.COLORS_DEMO_TESTER_EMAIL = "philipp@colorsxstudios.com"
    process.env.COLORS_DEMO_PASSWORD = "test-only-demo-password"
    process.env.ALLOWED_EMAILS = "philipp@colorsxstudios.com,operator@example.com"
    process.env.ADMIN_PASSWORD = "test-only-admin-password"
    expect(isAllowedPlatformEmail("philipp@colorsxstudios.com")).toBe(false)
    expect(isAllowedPlatformEmail("operator@example.com")).toBe(true)
    expect(demoPasswordMatches("Philipp@ColorsXStudios.com", "test-only-demo-password")).toBe(true)
    expect(demoPasswordMatches("other@example.com", "test-only-demo-password")).toBe(false)
    const token = await issueDemoToken({
      kind: "tester", email: "philipp@colorsxstudios.com", issuedAt: Date.now(),
    })
    expect(await verifyDemoToken(token ?? undefined, "tester")).toMatchObject({
      email: "philipp@colorsxstudios.com",
    })
    expect(await verifyDemoToken(token ?? undefined, "session")).toBeNull()
    const request = (password: string) => new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "philipp@colorsxstudios.com", password }),
    })
    const loggedIn = await login(request("test-only-demo-password"))
    expect(loggedIn.status).toBe(200)
    expect(loggedIn.cookies.get(DEMO_AUTH_COOKIE)?.value).toBeTruthy()
    expect(loggedIn.cookies.get("pe_auth")).toBeUndefined()
    expect((await login(request("test-only-admin-password"))).status).toBe(401)
  })

  it("rejects tampering, expiry and a changed tester identity", async () => {
    process.env.AUTH_SECRET = "test-only-secret"
    process.env.COLORS_DEMO_TESTER_EMAIL = "philipp@colorsxstudios.com"
    const expired = await issueDemoToken({
      kind: "session", email: "philipp@colorsxstudios.com",
      sessionId: crypto.randomUUID(), issuedAt: Date.now() - 25 * 60 * 60_000,
    })
    expect(await verifyDemoToken(expired ?? undefined, "session")).toBeNull()
    const fresh = await issueDemoToken({
      kind: "tester", email: "philipp@colorsxstudios.com", issuedAt: Date.now(),
    })
    expect(await verifyDemoToken(`${fresh}x`, "tester")).toBeNull()
    process.env.COLORS_DEMO_TESTER_EMAIL = "someone-else@example.com"
    expect(await verifyDemoToken(fresh ?? undefined, "tester")).toBeNull()
  })
})
