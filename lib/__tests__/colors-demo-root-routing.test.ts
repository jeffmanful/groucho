import { afterEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"
import { DEMO_AUTH_COOKIE, issueDemoToken } from "@/lib/colors-demo-token"

const originalSecret = process.env.AUTH_SECRET

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

describe("COLORS demo root routing", () => {
  it("sends a signed-in demo tester from the root link to the demo", async () => {
    process.env.AUTH_SECRET = "test-only-secret"
    const token = await issueDemoToken({
      kind: "tester",
      email: "philipp@colorsxstudios.com",
      issuedAt: Date.now(),
    })
    expect(token).toBeTruthy()
    const request = new NextRequest("https://example.test/")
    request.cookies.set(DEMO_AUTH_COOKIE, token!)

    const response = await proxy(request)
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://example.test/demo/colors")
  })
})
