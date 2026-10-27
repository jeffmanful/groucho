import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// A small chainable Supabase stand-in: each table returns the rows in `db`, filtered by eq/in.
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  inserts: [] as Array<{ table: string; row: unknown }>,
  rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
}))

vi.mock("@/lib/supabase", () => {
  function query(table: string) {
    let rows = [...(db.tables[table] ?? [])]
    let head = false
    const chain: Record<string, unknown> = {
      select(_cols?: string, opts?: { head?: boolean }) {
        head = Boolean(opts?.head)
        return chain
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] === value)
        return chain
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]))
        return chain
      },
      is(column: string, value: unknown) {
        rows = rows.filter((row) => (row[column] ?? null) === value)
        return chain
      },
      order() {
        return chain
      },
      limit() {
        return chain
      },
      insert(row: unknown) {
        db.inserts.push({ table, row })
        rows = [{ id: "new-1" }]
        return chain
      },
      async maybeSingle() {
        return { data: rows[0] ?? null, error: null }
      },
      async single() {
        return { data: rows[0] ?? null, error: null }
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(head ? { count: rows.length, error: null } : { data: rows, error: null }).then(resolve)
      },
    }
    return chain
  }
  return {
    supabase: {
      from: query,
      async rpc(name: string, args: Record<string, unknown>) {
        db.rpc.push({ name, args })
        return { data: [{ run_id: "run-1", moved: (args.p_session_ids as unknown[]).length }], error: null }
      },
    },
  }
})

vi.mock("@/lib/allocation-events", () => ({
  enqueueAllocationWebhooks: vi.fn(async () => {}),
  enqueueRunWebhook: vi.fn(async () => {}),
  enqueueDecisionWebhooksBulk: vi.fn(async () => {}),
}))

vi.mock("@/lib/project-resolution", () => ({
  resolveProjectContext: vi.fn(async () => ({ ok: true, context: { organisationId: "org-1", projectId: "project-1", apiKeyId: "key-1" } })),
}))

vi.mock("@/lib/api-key-scopes", () => ({
  resolveApplicationsKey: vi.fn(async () => ({ ok: true, context: { organisationId: "org-1", projectId: "project-1", apiKeyId: "key-2" } })),
}))

import { applicationAccess } from "@/lib/application-access"
import { planDraw } from "@/lib/cohorts"
import { parseEntryInput } from "@/lib/entries"
import { parseEntryFilters } from "@/lib/entry-review"

beforeEach(() => {
  db.tables = {}
  db.inserts = []
  db.rpc = []
})

describe("parseEntryInput", () => {
  it("normalises a full entry", () => {
    const parsed = parseEntryInput({
      applicant: { email: " Sam@Example.com ", name: " Sam " },
      phone: "+44 7700 900123",
      socials: ["https://instagram.com/sam", "https://instagram.com/sam", " "],
      fields: { size: 9, city: " London ", empty: "" },
    })
    expect(parsed).toEqual({
      ok: true,
      value: { email: "sam@example.com", name: "Sam", phone: "+44 7700 900123", socials: ["https://instagram.com/sam"], fields: { size: "9", city: "London" } },
    })
  })

  it("rejects bad input", () => {
    expect(parseEntryInput({ applicant: { email: "nope" } }).ok).toBe(false)
    expect(parseEntryInput({ applicant: { email: "a@b.co" }, phone: "call me" }).ok).toBe(false)
    expect(parseEntryInput({ applicant: { email: "a@b.co" }, socials: Array(9).fill("x") }).ok).toBe(false)
    expect(parseEntryInput({ applicant: { email: "a@b.co" }, fields: { "bad key": "x" } }).ok).toBe(false)
    expect(parseEntryInput({ applicant: { email: "a@b.co" }, fields: { size: { nested: true } } }).ok).toBe(false)
  })
})

describe("parseEntryFilters", () => {
  it("reads the list query and drops anything unsafe", () => {
    const filters = parseEntryFilters(new URLSearchParams("tab=flagged&noFlags=1&field=size&value=9&value=10&conversation=none&q=sam%2C)or(&limit=9999"))
    expect(filters).toMatchObject({ tab: "flagged", noFlags: true, field: "size", values: ["9", "10"], conversation: "none", search: "samor" })
    expect(filters.limit).toBeLessThanOrEqual(200)
    expect(parseEntryFilters(new URLSearchParams("tab=nope&field=a.b")).tab).toBe("review")
    expect(parseEntryFilters(new URLSearchParams("field=a.b")).field).toBeNull()
  })
})

describe("planDraw", () => {
  const identity = <T,>(items: readonly T[]) => [...items]
  const pool = [
    { id: "a", value: "9" },
    { id: "b", value: "10" },
    { id: "c", value: "9" },
    { id: "d", value: "10" },
    { id: "e", value: "9" },
  ]

  it("draws a single count and keeps the rest in order", () => {
    expect(planDraw(pool, { count: 2 }, identity)).toEqual({ ok: true, winners: ["a", "b"], rest: ["c", "d", "e"] })
  })

  it("draws per field value", () => {
    expect(planDraw(pool, { byField: "size", perValue: { "9": 2, "10": 1 } }, identity)).toEqual({
      ok: true,
      // Values in numeric order: size 9 before size 10.
      winners: ["a", "c", "b"],
      rest: ["e", "d"],
    })
  })

  it("needs a positive count", () => {
    expect(planDraw(pool, { count: 0 }, identity).ok).toBe(false)
    expect(planDraw(pool, { byField: "size", perValue: {} }, identity).ok).toBe(false)
  })

  it("never draws more than the pool", () => {
    const result = planDraw(pool, { count: 50 })
    expect(result.ok && result.winners.length).toBe(5)
    expect(result.ok && new Set(result.winners).size).toBe(5)
  })
})

describe("applicationAccess", () => {
  const approved = { id: "d1", session_id: "s1", decision: "approved", access_secret: "decision-secret", superseded_by: null }

  it("uses the decision secret when the project has no cohorts", async () => {
    db.tables = { application_decisions: [approved], cohorts: [] }
    expect(await applicationAccess({ sessionId: "s1", projectId: "project-1", secret: "decision-secret" })).toEqual({ granted: true, approved: true })
  })

  it("needs a place in a cohort that grants access once cohorts exist", async () => {
    db.tables = {
      application_decisions: [approved],
      cohorts: [
        { id: "pool", project_id: "project-1", grants_access: false, archived_at: null },
        { id: "winners", project_id: "project-1", grants_access: true, archived_at: null },
      ],
      cohort_members: [{ session_id: "s1", cohort_id: "pool", access_secret: "pool-secret" }],
    }
    expect((await applicationAccess({ sessionId: "s1", projectId: "project-1", secret: "decision-secret" })).granted).toBe(false)
    expect((await applicationAccess({ sessionId: "s1", projectId: "project-1", secret: "pool-secret" })).granted).toBe(false)
    db.tables.cohort_members = [{ session_id: "s1", cohort_id: "winners", access_secret: "win-secret" }]
    expect((await applicationAccess({ sessionId: "s1", projectId: "project-1", secret: "win-secret" })).granted).toBe(true)
  })

  it("never grants access after a decline", async () => {
    db.tables = {
      application_decisions: [{ ...approved, decision: "declined", access_secret: null }],
      cohorts: [{ id: "winners", project_id: "project-1", grants_access: true, archived_at: null }],
      cohort_members: [{ session_id: "s1", cohort_id: "winners", access_secret: "win-secret" }],
    }
    expect(await applicationAccess({ sessionId: "s1", projectId: "project-1", secret: "win-secret" })).toEqual({ granted: false, approved: false })
  })
})

describe("POST /v1/entries", () => {
  it("validates the body", async () => {
    const { POST } = await import("@/app/v1/entries/route")
    const res = await POST(new NextRequest("http://localhost/v1/entries", { method: "POST", body: JSON.stringify({ sessionId: "short", applicant: { email: "a@b.co" } }) }))
    expect(res.status).toBe(400)
    const bad = await POST(new NextRequest("http://localhost/v1/entries", { method: "POST", body: JSON.stringify({ sessionId: "entry-0001", applicant: { email: "x" } }) }))
    expect(bad.status).toBe(400)
  })

  it("records a form entry", async () => {
    const { POST } = await import("@/app/v1/entries/route")
    const res = await POST(
      new NextRequest("http://localhost/v1/entries", {
        method: "POST",
        body: JSON.stringify({ sessionId: "entry-0001", applicant: { email: "sam@example.com" }, fields: { size: "9" } }),
      }),
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ sessionId: "entry-0001", status: "received", duplicate: false })
    expect(db.inserts[0]).toMatchObject({
      table: "sessions",
      row: { project_id: "project-1", session_id: "entry-0001", status: "completed", entry_kind: "form", entry: { socials: [], fields: { size: "9" } } },
    })
  })
})

describe("POST /v1/cohorts/{id}/members", () => {
  const params = (cohortId: string) => ({ params: Promise.resolve({ cohortId }) })
  const req = (body: unknown) => new NextRequest("http://localhost/v1/cohorts/c1/members", { method: "POST", body: JSON.stringify(body) })

  it("lists session ids it doesn't know", async () => {
    db.tables = { cohorts: [{ id: "c1", project_id: "project-1" }], sessions: [{ id: "row-1", session_id: "known", project_id: "project-1" }] }
    const { POST } = await import("@/app/v1/cohorts/[cohortId]/members/route")
    const res = await POST(req({ sessionIds: ["known", "missing"] }), params("c1"))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ unknown: ["missing"] })
    expect(db.rpc).toEqual([])
  })

  it("places people as the API key", async () => {
    db.tables = {
      cohorts: [{ id: "c1", project_id: "project-1" }],
      sessions: [{ id: "row-1", session_id: "known", project_id: "project-1" }],
      allocation_rounds: [{ id: "round-1", project_id: "project-1", organisation_id: "org-1", name: "Drop", opens_at: null, closes_at: null }],
    }
    const { POST } = await import("@/app/v1/cohorts/[cohortId]/members/route")
    const res = await POST(req({ sessionIds: ["known"], reason: "Our own ballot" }), params("c1"))
    expect(res.status).toBe(200)
    expect(db.rpc[0]).toMatchObject({
      name: "allocate_to_cohort",
      args: { p_round_id: "round-1", p_session_ids: ["row-1"], p_target_cohort_id: "c1", p_kind: "api", p_actor_kind: "api", p_api_key_id: "key-2", p_reason: "Our own ballot" },
    })
  })

  it("rejects an unknown cohort", async () => {
    db.tables = { cohorts: [] }
    const { POST } = await import("@/app/v1/cohorts/[cohortId]/members/route")
    expect((await POST(req({ sessionIds: ["known"] }), params("c9"))).status).toBe(404)
  })
})
