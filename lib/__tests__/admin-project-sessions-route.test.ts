import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const database = vi.hoisted(() => ({ legacyPolicySchema: false }))

vi.mock("@/lib/admin-actor", () => ({
  resolveAdminActor: vi.fn(async () => ({
    kind: "member",
    userId: "member-1",
    email: "member@example.com",
  })),
}))

vi.mock("@/lib/org-access", () => ({
  requireOrgMember: vi.fn(async () => null),
  unauthorized: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      let selected = ""
      const chain = {
        select(columns: string) {
          selected = columns
          return chain
        },
        eq() {
          return chain
        },
        order() {
          return chain
        },
        async maybeSingle() {
          if (table === "projects") {
            return {
              data: {
                id: "project-1",
                settings: {
                  decision_policy: {
                    acceptance_threshold: 0.8,
                    review_threshold: 0.55,
                  },
                },
              },
              error: null,
            }
          }
          return { data: null, error: null }
        },
        async range() {
          if (
            table === "sessions" &&
            database.legacyPolicySchema &&
            selected.includes("suitability_score")
          ) {
            return {
              data: null,
              count: null,
              error: {
                code: "42703",
                message: "column sessions.suitability_score does not exist",
              },
            }
          }
          if (table === "sessions") {
            return {
              data: [
                {
                  id: "session-1",
                  session_id: "applicant-session-1",
                  status: "passed",
                  persona_id: null,
                  created_at: "2026-09-07T08:00:00.000Z",
                  updated_at: "2026-09-07T08:05:00.000Z",
                  profile_extracted_at: null,
                  applicant_email: "applicant@example.com",
                  applicant_name: null,
                  ...(selected.includes("suitability_score")
                    ? { suitability_score: 0.86 }
                    : {}),
                },
              ],
              count: 1,
              error: null,
            }
          }
          return { data: [], count: 0, error: null }
        },
        async in() {
          if (
            table === "application_decisions" &&
            database.legacyPolicySchema &&
            selected.includes("decision_source")
          ) {
            return {
              data: null,
              error: {
                code: "42703",
                message:
                  "column application_decisions.decision_source does not exist",
              },
            }
          }
          if (table === "application_decisions") {
            return {
              data: [
                {
                  session_id: "session-1",
                  decision: "approved",
                  ...(selected.includes("decision_source")
                    ? { decision_source: "policy" }
                    : {}),
                },
              ],
              error: null,
            }
          }
          return { data: [], error: null }
        },
      }
      return chain
    },
  },
}))

describe("admin project sessions route", () => {
  beforeEach(() => {
    database.legacyPolicySchema = false
    vi.restoreAllMocks()
  })

  async function getSessions() {
    const { GET } = await import(
      "@/app/api/admin/organisations/[orgId]/projects/[projectId]/sessions/route"
    )
    return GET(
      new NextRequest("http://localhost/api/admin/sessions"),
      {
        params: Promise.resolve({ orgId: "org-1", projectId: "project-1" }),
      },
    )
  }

  it("returns suitability and policy decision data on the current schema", async () => {
    const response = await getSessions()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.sessions[0]).toMatchObject({
      suitability_score: 0.86,
      suitability_band: "recommended_acceptance",
      review_status: "approved",
      decision_source: "policy",
    })
  })

  it("loads sessions when the decision-policy migration is not applied yet", async () => {
    database.legacyPolicySchema = true
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const response = await getSessions()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.sessions[0]).toMatchObject({
      suitability_score: null,
      suitability_band: null,
      review_status: "approved",
      decision_source: "human",
    })
  })
})
