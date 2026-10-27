import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"

const insertedRows = vi.hoisted(() => [] as Record<string, unknown>[])
const state = vi.hoisted(() => ({
  sessionStatus: "passed",
  verdictPayload: { reviewer_report: { advisory_recommendation: "recommend" } } as Record<string, unknown> | null,
  closingMetadata: null as Record<string, unknown> | null,
}))

vi.mock("@/lib/admin-actor", () => ({
  resolveAdminActor: vi.fn(async () => ({
    kind: "member",
    userId: "reviewer-1",
    email: "reviewer@example.com",
  })),
}))

vi.mock("@/lib/org-access", () => ({
  requireOrgAdmin: vi.fn(async () => null),
  unauthorized: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      let inserted: Record<string, unknown> | null = null
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        order() {
          return chain
        },
        limit() {
          return chain
        },
        insert(row: Record<string, unknown>) {
          inserted = row
          insertedRows.push(row)
          return chain
        },
        async maybeSingle() {
          if (table === "sessions") {
            return { data: { id: "session-1", status: state.sessionStatus }, error: null }
          }
          if (table === "application_decisions") {
            return { data: null, error: null }
          }
          if (table === "verdicts") {
            return { data: state.verdictPayload ? { payload: state.verdictPayload } : null, error: null }
          }
          if (table === "messages") {
            return { data: state.closingMetadata ? { metadata: state.closingMetadata } : null, error: null }
          }
          return { data: null, error: null }
        },
        async single() {
          if (table === "application_decisions" && inserted) {
            return {
              data: {
                id: "decision-1",
                decision: inserted.decision,
                advisory_recommendation: inserted.advisory_recommendation,
                reviewer_kind: inserted.reviewer_kind,
                reason: inserted.reason,
                created_at: "2026-08-20T16:00:00.000Z",
              },
              error: null,
            }
          }
          return { data: null, error: { message: "unexpected single" } }
        },
      }
      return chain
    },
  },
}))

describe("human application decision route", () => {
  it("records reviewer identity and creates access authority only on approval", async () => {
    insertedRows.length = 0
    const { POST } = await import(
      "@/app/api/admin/organisations/[orgId]/projects/[projectId]/sessions/[sessionId]/decision/route"
    )
    const response = await POST(
      new NextRequest("http://localhost/api/admin/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approved",
          reason: "Clear evidence of thoughtful participation.",
        }),
      }),
      {
        params: Promise.resolve({
          orgId: "org-1",
          projectId: "project-1",
          sessionId: "session-1",
        }),
      },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.reviewStatus).toBe("approved")
    expect(body.accessSecret).toEqual(expect.any(String))
    expect(insertedRows[0]).toMatchObject({
      organisation_id: "org-1",
      project_id: "project-1",
      session_id: "session-1",
      decision: "approved",
      decision_source: "human",
      advisory_recommendation: "recommend",
      reviewer_kind: "member",
      reviewer_user_id: "reviewer-1",
      reviewer_email: "reviewer@example.com",
    })
    expect(insertedRows[0].access_secret).toBe(body.accessSecret)
  })

  async function decide(decision: string, reason = "") {
    const { POST } = await import(
      "@/app/api/admin/organisations/[orgId]/projects/[projectId]/sessions/[sessionId]/decision/route"
    )
    return POST(
      new NextRequest("http://localhost/api/admin/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      }),
      { params: Promise.resolve({ orgId: "org-1", projectId: "project-1", sessionId: "session-1" }) },
    )
  }

  it("decides newer-engine applications, taking the recommendation from the closing message", async () => {
    insertedRows.length = 0
    state.sessionStatus = "completed"
    state.verdictPayload = null
    state.closingMetadata = { reviewer_report: { advisory_recommendation: "human_review" } }
    const response = await decide("declined", "Not enough about how they would take part.")
    expect(response.status).toBe(200)
    expect(insertedRows[0]).toMatchObject({ decision: "declined", advisory_recommendation: "human_review", access_secret: null })
  })

  it.each(["active", "abandoned"])("refuses to decide a %s session", async (status) => {
    insertedRows.length = 0
    state.sessionStatus = status
    const response = await decide("approved")
    expect(response.status).toBe(409)
    expect(insertedRows).toHaveLength(0)
  })

  it("requires a reason to decline", async () => {
    state.sessionStatus = "completed"
    expect((await decide("declined", "  ")).status).toBe(400)
  })
})
