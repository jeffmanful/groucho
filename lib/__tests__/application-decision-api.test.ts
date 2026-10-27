import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { hashApiKeySecret } from "@/lib/api-keys"

// A small stand-in for the Supabase query builder: each table returns what `db` holds.
const db = vi.hoisted(() => ({
  apiKey: null as Record<string, unknown> | null,
  session: { id: "session-1", status: "completed" } as Record<string, unknown> | null,
  existingDecision: null as Record<string, unknown> | null,
  hooks: [] as Array<{ id: string; events: string[] }>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
}))
const delivered = vi.hoisted(() => [] as string[])

vi.mock("@/lib/verdict-webhook", () => ({
  tryDeliverWebhook: vi.fn(async (id: string) => {
    delivered.push(id)
  }),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      let inserted: Record<string, unknown> | null = null
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          db.filters.push({ table, column, value })
          return chain
        },
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        then: (resolve: (value: unknown) => void) => {
          // Awaiting the chain directly (webhook list, last_used_at update).
          resolve(table === "webhooks" ? { data: db.hooks, error: null } : { data: null, error: null })
        },
        insert(row: Record<string, unknown>) {
          inserted = row
          db.inserts.push({ table, row })
          return chain
        },
        async maybeSingle() {
          if (table === "api_keys") return { data: db.apiKey, error: null }
          if (table === "sessions") return { data: db.session, error: null }
          if (table === "application_decisions") return { data: db.existingDecision, error: null }
          return { data: null, error: null }
        },
        async single() {
          if (table === "application_decisions" && inserted) {
            return {
              data: { id: "decision-1", ...inserted, created_at: "2026-10-27T10:00:00.000Z" },
              error: null,
            }
          }
          if (table === "webhook_deliveries" && inserted) {
            return { data: { id: `delivery-${inserted.webhook_id as string}` }, error: null }
          }
          return { data: null, error: { message: "unexpected single" } }
        },
      }
      return chain
    },
  },
}))

const APPLICATIONS_KEY = "gk_live_applications"

function applicationsKey(scopes: string[] | undefined) {
  return {
    id: "key-1",
    organisation_id: "org-1",
    project_id: "project-1",
    key_hash: hashApiKeySecret(APPLICATIONS_KEY),
    ...(scopes ? { scopes } : {}),
  }
}

async function decide(body: unknown, authorization: string | null = `Bearer ${APPLICATIONS_KEY}`) {
  const { POST } = await import("@/app/v1/applications/[sessionId]/decision/route")
  return POST(
    new NextRequest("http://localhost/v1/applications/forum_app_1/decision", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId: "forum_app_1" }) },
  )
}

beforeEach(() => {
  db.apiKey = applicationsKey(["applications"])
  db.session = { id: "session-1", status: "completed" }
  db.existingDecision = null
  db.hooks = []
  db.inserts.length = 0
  db.filters.length = 0
  delivered.length = 0
})

describe("API key scopes", () => {
  it("defaults to conversations and accepts exactly one known scope", async () => {
    const { parseApiKeyScopes } = await import("@/lib/api-key-scopes")
    expect(parseApiKeyScopes(undefined)).toEqual(["conversations"])
    expect(parseApiKeyScopes(["applications"])).toEqual(["applications"])
    expect(parseApiKeyScopes(["conversations", "applications"])).toBeNull()
    expect(parseApiKeyScopes(["admin"])).toBeNull()
    expect(parseApiKeyScopes("applications")).toBeNull()
  })

  it("refuses requests without a key", async () => {
    expect((await decide({ decision: "approved" }, null)).status).toBe(401)
  })

  it.each([
    ["a conversations key", ["conversations"]],
    ["a key from before scopes existed", undefined],
  ])("refuses %s", async (_label, scopes) => {
    db.apiKey = applicationsKey(scopes)
    const response = await decide({ decision: "approved" })
    expect(response.status).toBe(403)
    expect(db.inserts).toHaveLength(0)
  })
})

describe("POST /v1/applications/{sessionId}/decision", () => {
  it("records an API decision for the named reviewer, scoped to the key's project", async () => {
    const response = await decide({
      decision: "approved",
      reviewer: { email: "mod@colors.example", name: "Mod" },
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({
      sessionId: "forum_app_1",
      reviewStatus: "approved",
      decision: { decision: "approved", source: "human", via: "api" },
      accessSecret: expect.any(String),
    })
    const decision = db.inserts.find((insert) => insert.table === "application_decisions")?.row
    expect(decision).toMatchObject({
      organisation_id: "org-1",
      project_id: "project-1",
      session_id: "session-1",
      decision_source: "human",
      reviewer_kind: "api",
      reviewer_user_id: null,
      reviewer_email: "mod@colors.example",
      reviewer_name: "Mod",
      api_key_id: "key-1",
      access_secret: body.accessSecret,
    })
    expect(db.filters).toContainEqual({ table: "sessions", column: "project_id", value: "project-1" })
    expect(db.filters).toContainEqual({ table: "sessions", column: "session_id", value: "forum_app_1" })
  })

  it("requires a reason to decline", async () => {
    expect((await decide({ decision: "declined", reason: " " })).status).toBe(400)
    expect(db.inserts).toHaveLength(0)
  })

  it("rejects an invalid reviewer email", async () => {
    expect((await decide({ decision: "approved", reviewer: { email: "nope" } })).status).toBe(400)
  })

  it("returns the existing decision when one is already recorded", async () => {
    db.existingDecision = { id: "d-0", decision: "approved", decision_source: "human", reviewer_kind: "member" }
    const response = await decide({ decision: "declined", reason: "Late" })
    expect(response.status).toBe(409)
    expect((await response.json()).existing).toMatchObject({ id: "d-0", reviewer_kind: "member" })
    expect(db.inserts).toHaveLength(0)
  })

  it("returns 404 for a session outside the key's project", async () => {
    db.session = null
    expect((await decide({ decision: "approved" })).status).toBe(404)
  })

  it("queues application.decided for webhooks that want it", async () => {
    db.hooks = [
      { id: "hook-old", events: ["session.completed"] },
      { id: "hook-new", events: ["session.completed", "application.decided"] },
      { id: "hook-all", events: [] },
    ]
    expect((await decide({ decision: "approved" })).status).toBe(201)
    const deliveries = db.inserts.filter((insert) => insert.table === "webhook_deliveries").map((insert) => insert.row)
    expect(deliveries.map((row) => row.webhook_id)).toEqual(["hook-new", "hook-all"])
    expect(deliveries[0]).toMatchObject({ decision_id: "decision-1", event: "application.decided", status: "pending" })
    expect(delivered).toEqual(["delivery-hook-new", "delivery-hook-all"])
  })
})

describe("webhook events", () => {
  it("treats an empty event list as every event", async () => {
    const { webhookWantsEvent } = await import("@/lib/decision-webhook")
    expect(webhookWantsEvent([], "application.decided")).toBe(true)
    expect(webhookWantsEvent(null, "application.decided")).toBe(true)
    expect(webhookWantsEvent(["session.completed"], "application.decided")).toBe(false)
  })

  it("accepts only known events, in a stable order", async () => {
    const { parseWebhookEvents } = await import("@/lib/webhook-events")
    expect(parseWebhookEvents(["application.decided", "session.completed"])).toEqual(["session.completed", "application.decided"])
    expect(parseWebhookEvents(["verdict.created"])).toBeNull()
    expect(parseWebhookEvents([])).toBeNull()
  })
})
