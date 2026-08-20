import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const testState = vi.hoisted(() => ({
  decision: null as null | { decision: string; access_secret: string | null },
}))

vi.mock("@/lib/project-resolution", () => ({
  resolveProjectContext: vi.fn(async () => ({
    ok: true,
    context: { projectId: "project-1", apiKeyId: "key-1" },
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  readRateLimitConfig: () => ({ sessionPerMinute: 20 }),
  checkRateLimit: () => ({ ok: true }),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        async maybeSingle() {
          if (table === "sessions") {
            return {
              data: {
                id: "session-row-1",
                status: "passed",
                applicant_email: "listener@example.com",
              },
              error: null,
            }
          }
          if (table === "application_decisions") {
            return { data: testState.decision, error: null }
          }
          return { data: null, error: null }
        },
      }
      return chain
    },
  },
}))

function request(secret: string) {
  return new NextRequest("http://localhost/v1/sessions/client-session/access", {
    method: "POST",
    headers: {
      authorization: "Bearer gk_test_key",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "listener@example.com", secret }),
  })
}

describe("application access route", () => {
  beforeEach(() => {
    testState.decision = null
  })

  it("does not grant access from a legacy passed session without human approval", async () => {
    const { POST } = await import("@/app/v1/sessions/[sessionId]/access/route")
    const response = await POST(request("legacy-pass-secret"), {
      params: Promise.resolve({ sessionId: "client-session" }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Session not eligible" })
  })

  it("requires the secret belonging to the human approval", async () => {
    testState.decision = {
      decision: "approved",
      access_secret: "human-approval-secret",
    }
    const { POST } = await import("@/app/v1/sessions/[sessionId]/access/route")
    const response = await POST(request("legacy-pass-secret"), {
      params: Promise.resolve({ sessionId: "client-session" }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or missing secret",
    })
  })
})
