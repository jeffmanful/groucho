import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  session: { id: "session-1" } as Record<string, unknown> | null,
  current: { id: "d-1", decision: "declined" } as Record<string, unknown> | null,
  rpc: null as { data: unknown; error: { code: string; message: string } | null } | null,
  rpcArgs: null as Record<string, unknown> | null,
  hooks: [{ id: "hook-1", events: ["application.decided", "application.decision_corrected"] }],
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  insertError: null as { code: string } | null,
}))

vi.mock("@/lib/verdict-webhook", () => ({ tryDeliverWebhook: vi.fn(async () => {}) }))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    async rpc(_name: string, args: Record<string, unknown>) {
      db.rpcArgs = args
      return db.rpc
    },
    from(table: string) {
      let inserted: Record<string, unknown> | null = null
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        then: (resolve: (value: unknown) => void) =>
          resolve(table === "webhooks" ? { data: db.hooks, error: null } : { data: [], error: null }),
        insert(row: Record<string, unknown>) {
          inserted = row
          db.inserts.push({ table, row })
          return chain
        },
        async maybeSingle() {
          if (table === "sessions") return { data: db.session, error: null }
          if (table === "application_decisions") return { data: db.current, error: null }
          return { data: null, error: null }
        },
        async single() {
          if (table === "application_outcomes") {
            if (db.insertError) return { data: null, error: db.insertError }
            return { data: { id: "o-1", ...inserted, reported_at: "2026-10-27T12:00:00Z" }, error: null }
          }
          if (table === "webhook_deliveries") return { data: { id: "delivery-1" }, error: null }
          return { data: null, error: null }
        },
      }
      return chain
    },
  },
}))

beforeEach(() => {
  db.session = { id: "session-1" }
  db.current = { id: "d-1", decision: "declined" }
  db.rpc = {
    data: [{
      id: "d-2", decision: "approved", reason: "Clarified on a call", applicant_reason: "Welcome in",
      supersedes_decision_id: "d-1", reviewer_kind: "member", created_at: "2026-10-27T12:00:00Z",
    }],
    error: null,
  }
  db.rpcArgs = null
  db.inserts.length = 0
  db.insertError = null
})

const input = {
  organisationId: "org-1",
  projectId: "project-1",
  sessionId: "session-1",
  expectedDecisionId: "d-1",
  decision: "approved" as const,
  reason: "Clarified on a call",
  applicantReason: "Welcome in",
  reviewer: { kind: "member" as const, userId: "user-1", email: "maya@colors.example" },
}

describe("correcting a decision", () => {
  it("calls the correction function with the reviewer and a fresh secret for approvals", async () => {
    const { correctApplicationDecision } = await import("@/lib/application-decision-correction")
    const result = await correctApplicationDecision(input)
    expect(result).toMatchObject({ ok: true, replaced: { id: "d-1", decision: "declined" }, accessSecret: expect.any(String) })
    expect(db.rpcArgs).toMatchObject({
      p_session_id: "session-1",
      p_expected_decision_id: "d-1",
      p_decision: "approved",
      p_reason: "Clarified on a call",
      p_applicant_reason: "Welcome in",
      p_reviewer_kind: "member",
      p_reviewer_user_id: "user-1",
      p_access_secret: result.ok ? result.accessSecret : null,
    })
  })

  it("sends application.decision_corrected", async () => {
    const { correctApplicationDecision } = await import("@/lib/application-decision-correction")
    await correctApplicationDecision(input)
    expect(db.inserts.find((insert) => insert.table === "webhook_deliveries")?.row).toMatchObject({
      decision_id: "d-2",
      event: "application.decision_corrected",
    })
  })

  it("requires a reason before touching the database", async () => {
    const { correctApplicationDecision } = await import("@/lib/application-decision-correction")
    expect(await correctApplicationDecision({ ...input, reason: "  " })).toMatchObject({ ok: false, status: 400 })
    expect(db.rpcArgs).toBeNull()
  })

  it("explains a stale correction", async () => {
    db.rpc = { data: null, error: { code: "GR409", message: "changed" } }
    const { correctApplicationDecision } = await import("@/lib/application-decision-correction")
    expect(await correctApplicationDecision(input)).toMatchObject({ ok: false, status: 409, current: { id: "d-1" } })
  })

  it.each([
    ["GR422", 422],
    ["GR404", 404],
  ])("maps %s to %i", async (code, status) => {
    db.rpc = { data: null, error: { code, message: "x" } }
    const { correctApplicationDecision } = await import("@/lib/application-decision-correction")
    expect(await correctApplicationDecision(input)).toMatchObject({ ok: false, status })
  })

  it("has nothing to correct before a decision exists", async () => {
    db.current = null
    const { correctApplicationDecision } = await import("@/lib/application-decision-correction")
    expect(await correctApplicationDecision(input)).toMatchObject({ ok: false, status: 404 })
  })
})

describe("reported outcomes", () => {
  it("parses outcomes and timestamps", async () => {
    const { parseApplicationOutcome, parseOccurredAt } = await import("@/lib/application-outcomes")
    expect(parseApplicationOutcome("joined")).toBe("joined")
    expect(parseApplicationOutcome("vip")).toBeNull()
    const now = new Date("2026-10-27T12:00:00Z")
    expect(parseOccurredAt(undefined, now)).toBe("2026-10-27T12:00:00.000Z")
    expect(parseOccurredAt("2026-10-20T09:00:00Z", now)).toBe("2026-10-20T09:00:00.000Z")
    expect(parseOccurredAt("2026-11-20T09:00:00Z", now)).toBeNull()
    expect(parseOccurredAt("yesterday", now)).toBeNull()
  })

  it("links an outcome to the current decision", async () => {
    const { recordApplicationOutcome } = await import("@/lib/application-outcomes")
    const result = await recordApplicationOutcome({
      organisationId: "org-1", projectId: "project-1", sessionId: "session-1",
      outcome: "joined", occurredAt: "2026-10-27T10:00:00.000Z", apiKeyId: "key-1",
    })
    expect(result).toMatchObject({ ok: true, duplicate: false })
    expect(db.inserts[0]).toMatchObject({ table: "application_outcomes", row: { decision_id: "d-1", outcome: "joined", api_key_id: "key-1" } })
  })

  it("ignores a repeated report", async () => {
    db.insertError = { code: "23505" }
    const { recordApplicationOutcome } = await import("@/lib/application-outcomes")
    expect(await recordApplicationOutcome({
      organisationId: "org-1", projectId: "project-1", sessionId: "session-1", outcome: "joined", occurredAt: "2026-10-27T10:00:00.000Z",
    })).toEqual({ ok: true, outcome: null, duplicate: true })
  })

  it("refuses outcomes before a decision", async () => {
    db.current = null
    const { recordApplicationOutcome } = await import("@/lib/application-outcomes")
    expect(await recordApplicationOutcome({
      organisationId: "org-1", projectId: "project-1", sessionId: "session-1", outcome: "invited", occurredAt: "2026-10-27T10:00:00.000Z",
    })).toMatchObject({ ok: false, status: 409 })
  })
})
