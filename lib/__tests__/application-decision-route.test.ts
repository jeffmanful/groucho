import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"

const insertedRows = vi.hoisted(() => [] as Record<string, unknown>[])

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
            return { data: { id: "session-1", status: "passed" }, error: null }
          }
          if (table === "application_decisions") {
            return { data: null, error: null }
          }
          if (table === "verdicts") {
            return {
              data: {
                payload: {
                  reviewer_report: { advisory_recommendation: "recommend" },
                },
              },
              error: null,
            }
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
      advisory_recommendation: "recommend",
      reviewer_kind: "member",
      reviewer_user_id: "reviewer-1",
      reviewer_email: "reviewer@example.com",
    })
    expect(insertedRows[0].access_secret).toBe(body.accessSecret)
  })
})
