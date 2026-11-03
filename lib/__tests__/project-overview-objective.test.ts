import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { MAX_OBJECTIVE_LENGTH, parseObjectiveUpdate, readProjectObjective } from "@/lib/project-review-objective"

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as Array<{ table: string; filters: Array<[string, unknown]>; action: string }>,
  writes: [] as Array<{ table: string; values: Record<string, unknown> }>,
  race: false,
  auditFailure: false,
  denied: false,
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let values: Record<string, unknown> | null = null
      let action = "read"
      let head = false
      let limit = Infinity
      const orders: Array<{ column: string; ascending: boolean }> = []
      const result = () => {
        db.calls.push({ table, filters: [...filters], action })
        if (db.race && action === "update") {
          db.race = false
          db.tables.projects[0].settings = { decision_policy: { acceptance_threshold: 0.95 } }
        }
        let rows = (db.tables[table] ?? []).filter((row) => filters.every(([column, value]) => column === "settings"
          ? JSON.stringify(row.settings) === value : (row[column] ?? null) === value))
        rows = [...rows].sort((a, b) => {
          for (const order of orders) {
            const compared = String(a[order.column] ?? "").localeCompare(String(b[order.column] ?? ""))
            if (compared) return order.ascending ? compared : -compared
          }
          return 0
        }).slice(0, limit)
        if (values) {
          if (action === "insert") {
            if (db.auditFailure) return { data: null, count: 0, error: { code: "42P01" } }
            db.writes.push({ table, values })
            rows = [values]
          } else {
            for (const row of rows) { Object.assign(row, values); db.writes.push({ table, values }) }
          }
        }
        return { data: head ? null : rows, count: rows.length, error: null }
      }
      const chain = {
        select(_columns?: string, options?: { head?: boolean }) { head = options?.head ?? false; return chain },
        eq(column: string, value: unknown) { filters.push([column, value]); return chain },
        is(column: string, value: unknown) { filters.push([column, value]); return chain },
        order(column: string, options?: { ascending?: boolean }) { orders.push({ column, ascending: options?.ascending ?? true }); return chain },
        limit(value: number) { limit = value; return chain },
        update(next: Record<string, unknown>) { action = "update"; values = next; return chain },
        insert(next: Record<string, unknown>) { action = "insert"; values = next; return chain },
        async maybeSingle() { const value = result(); return { ...value, data: value.data?.[0] ?? null } },
        async single() { const value = result(); return { ...value, data: value.data?.[0] ?? null, error: value.error ?? (!value.data?.length ? { code: "PGRST116" } : null) } },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/admin-project-route", () => ({
  projectRoute: vi.fn(async () => db.denied ? { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) }
    : { ok: true, value: { orgId: "colors", projectId: "p", actor: { kind: "member", userId: "reviewer", email: "reviewer@example.test" } } }),
  serverError: () => NextResponse.json({ error: "Database error" }, { status: 500 }),
}))
vi.mock("@/lib/project-resolution", () => ({ invalidateProjectSettingsCache: vi.fn() }))
vi.mock("@/lib/cohorts", () => ({
  listCohorts: vi.fn(async () => [{ id: "cohort", name: "Beta", members: 68, capacity: 100 }]),
  unallocatedIds: vi.fn(async () => ["approved-1", "approved-2"]),
}))
vi.mock("@/lib/admin-actor", () => ({ resolveAdminActor: vi.fn(async () => ({ kind: "member", userId: "reviewer", email: "reviewer@example.test" })) }))
vi.mock("@/lib/org-access", () => ({ requireOrgAdmin: vi.fn(async () => null), requireOrgMember: vi.fn(async () => null), unauthorized: () => NextResponse.json({}, { status: 401 }) }))
vi.mock("@/lib/persona-ownership", () => ({ projectPersonaChoiceError: vi.fn(async () => null) }))

const original = { project_type: "gatekeeper", decision_policy: { acceptance_threshold: 0.8, review_threshold: 0.55 } }

beforeEach(() => {
  db.tables = {
    projects: [{ id: "p", organisation_id: "colors", settings: structuredClone(original) }],
    allocation_rounds: [{ id: "round", project_id: "p", organisation_id: "colors", name: "Beta round", created_at: "2026-11-02" }],
    cohorts: [{ id: "cohort", project_id: "p", organisation_id: "colors", round_id: "round", archived_at: null }],
    application_review_queue: [
      { id: "pending", project_id: "p", organisation_id: "colors", queue: "ready_for_review", updated_at: "2026-11-01" },
      { id: "assessing", project_id: "p", organisation_id: "colors", queue: "awaiting_assessment" },
      { id: "foreign", project_id: "other", organisation_id: "other", queue: "ready_for_review" },
      { id: "approved", project_id: "p", organisation_id: "colors", queue: "approved" },
    ],
  }
  db.calls = []; db.writes = []; db.race = false; db.auditFailure = false; db.denied = false
})

describe("project overview", () => {
  it("combines this project's review work with actual cohort placements", async () => {
    const { buildProjectOverview } = await import("@/lib/project-overview")
    const result = await buildProjectOverview("colors", "p")
    expect(result.review).toEqual({ ready: 1, awaitingAssessment: 1, oldestPendingSince: "2026-11-01" })
    expect(result.cohorts[0]).toMatchObject({ members: 68, capacity: 100 })
    expect(result.unallocated).toBe(2)
    expect(result.objective).toBeNull()
    expect(db.writes).toEqual([])
  })

  it("does not create a round when a new client opens the overview", async () => {
    db.tables.allocation_rounds = []
    const { buildProjectOverview } = await import("@/lib/project-overview")
    const result = await buildProjectOverview("colors", "p")
    expect(result.round).toBeNull()
    expect(result.cohorts).toEqual([])
    expect(result.unallocated).toBe(1)
    expect(db.writes).toEqual([])
  })
})

describe("objective validation", () => {
  it("bounds reviewer content and requires the version that was edited", () => {
    expect(parseObjectiveUpdate({ text: "x".repeat(MAX_OBJECTIVE_LENGTH + 1), cohortId: null, revision: null }).ok).toBe(false)
    expect(parseObjectiveUpdate({ text: "Goal", cohortId: null }).ok).toBe(false)
    expect(parseObjectiveUpdate({ text: " Goal ", cohortId: null, revision: null })).toMatchObject({ ok: true, text: "Goal" })
    expect(parseObjectiveUpdate({ text: "  ", cohortId: null, revision: null })).toMatchObject({ ok: true, text: "" })
    expect(readProjectObjective({ review_objective: { text: "broken", revision: "r", updatedAt: "invalid" } })).toBeNull()
  })
})

async function save(body: unknown = { text: "Find passionate music community members.", cohortId: "cohort", revision: null }) {
  const { PATCH } = await import("@/app/api/admin/organisations/[orgId]/projects/[projectId]/objective/route")
  return PATCH(new Request("http://localhost/objective", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ orgId: "colors", projectId: "p" }) })
}

describe("saving the team's review objective", () => {
  it("lets a client member save guidance without changing assessment settings", async () => {
    const response = await save()
    expect(response.status).toBe(200)
    const objective = (await response.json()).objective
    expect(objective).toMatchObject({ text: "Find passionate music community members.", cohortId: "cohort", updatedBy: "reviewer@example.test" })
    expect(objective.revision).toEqual(expect.any(String))
    expect((db.tables.projects[0].settings as Record<string, unknown>).decision_policy).toEqual(original.decision_policy)
    expect(db.writes.find((write) => write.table === "project_settings_audit")?.values).toMatchObject({ actor_user_id: "reviewer", source: "review_objective", changed_keys: ["review_objective"] })
    expect(db.calls.find((call) => call.action === "update")?.filters).toContainEqual(["settings", JSON.stringify(original)])
  })

  it("rejects an out-of-scope project before reading or writing its brief", async () => {
    db.denied = true
    expect((await save()).status).toBe(404)
    expect(db.calls).toEqual([])
    expect(db.writes).toEqual([])
  })

  it.each(["foreign", "archived", "previous-round"])("rejects a %s focus cohort", async (kind) => {
    if (kind === "foreign") db.tables.cohorts[0].organisation_id = "other"
    if (kind === "archived") db.tables.cohorts[0].archived_at = "2026-11-01"
    if (kind === "previous-round") db.tables.cohorts[0].round_id = "old-round"
    expect((await save()).status).toBe(400)
    expect(db.writes).toEqual([])
  })

  it("rejects a stale objective revision instead of overwriting another reviewer's work", async () => {
    expect((await save()).status).toBe(200)
    db.writes = []
    expect((await save()).status).toBe(409)
    expect(db.writes).toEqual([])
  })

  it("protects concurrent project settings changes during the save", async () => {
    db.race = true
    expect((await save()).status).toBe(409)
    expect(db.tables.projects[0].settings).toEqual({ decision_policy: { acceptance_threshold: 0.95 } })
    expect(db.writes).toEqual([])
  })

  it("reports a history failure as saved with a warning", async () => {
    db.auditFailure = true
    const response = await save()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ warning: expect.any(String), objective: { text: expect.any(String) } })
    expect(readProjectObjective(db.tables.projects[0].settings)?.text).toBeTruthy()
  })

  it("keeps the brief when an older admin settings form is saved", async () => {
    await save()
    const objective = readProjectObjective(db.tables.projects[0].settings)
    const { PATCH } = await import("@/app/api/admin/organisations/[orgId]/projects/[projectId]/route")
    const response = await PATCH(new NextRequest("http://localhost/project", { method: "PATCH", body: JSON.stringify({ settings: { archived: true, review_objective: { text: "Stale copy" } } }) }), { params: Promise.resolve({ orgId: "colors", projectId: "p" }) })
    expect(response.status).toBe(200)
    expect(readProjectObjective(db.tables.projects[0].settings)).toEqual(objective)
    expect(db.tables.projects[0].settings).toMatchObject({ archived: true })
  })
})
