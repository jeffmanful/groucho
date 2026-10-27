import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  verdictPayload: null as Record<string, unknown> | null,
}))

vi.mock("@/lib/project-resolution", () => ({
  resolveProjectContext: async () => ({
    ok: true,
    context: { organisationId: "org-1", projectId: "project-1", apiKeyId: "key-1", settings: { projectType: "gatekeeper", flowConfig: null, raw: {} } },
  }),
}))
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const data = table === "sessions" ? mocks.session
        : table === "verdicts" ? (mocks.verdictPayload ? { payload: mocks.verdictPayload } : null)
          : null
      const chain = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 3, data: [], error: null }).then(resolve),
      }
      return chain
    },
  },
}))

import { GET } from "@/app/v1/sessions/[sessionId]/route"

async function getSession() {
  const response = await GET(
    new NextRequest("https://example.test/v1/sessions/client-session-1", { headers: { authorization: "Bearer gk_test" } }),
    { params: Promise.resolve({ sessionId: "client-session-1" }) },
  )
  return response.json()
}

describe("GET /v1/sessions/{id} suitability", () => {
  beforeEach(() => {
    mocks.session = {
      id: "internal-1", session_id: "client-session-1", status: "completed",
      created_at: "2026-10-26T20:00:00Z", updated_at: "2026-10-26T20:05:00Z",
      applicant_email: "person@example.test", suitability_score: null,
    }
    mocks.verdictPayload = null
  })

  it("returns the report-derived score from a newer-engine verdict", async () => {
    mocks.verdictPayload = { suitability_score: 0.834, reviewer_report: { advisory_recommendation: "recommend" } }
    const body = await getSession()
    expect(body.status).toBe("completed")
    expect(body.suitabilityScore).toBe(0.834)
    expect(body.suitabilityBand).toBe("recommended_acceptance")
  })

  it("falls back to the score stored on the session", async () => {
    mocks.session.suitability_score = 0.765
    const body = await getSession()
    expect(body.suitabilityScore).toBe(0.765)
    expect(body.suitabilityBand).toBe("review")
  })

  it("keeps turn scores first for the previous engine", async () => {
    mocks.session.status = "passed"
    mocks.session.suitability_score = 0.5
    mocks.verdictPayload = { scores: { overall: 0.9 } }
    expect((await getSession()).suitabilityScore).toBe(0.9)
  })
})
