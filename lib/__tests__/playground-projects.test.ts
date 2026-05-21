import { describe, expect, it, vi } from "vitest"
import type { AdminActor } from "@/lib/admin-actor"

function createMockSupabase() {
  const state = {
    organisations: [
      { id: "org-a", name: "Alpha" },
      { id: "org-b", name: "Beta" },
    ],
    projects: [
      {
        id: "proj-a",
        name: "Alpha Gate",
        slug: "alpha-gate",
        organisation_id: "org-a",
        settings: { project_type: "gatekeeper", environment: "test" },
      },
      {
        id: "proj-b",
        name: "Beta Onboard",
        slug: "beta-onboard",
        organisation_id: "org-b",
        settings: { project_type: "onboarding", environment: "live" },
      },
    ],
    organisation_members: [
      { organisation_id: "org-a", user_id: "user-1", role: "member" },
    ],
  }

  function buildChain(table: string) {
    const ctx = {
      table,
      filters: [] as { col: string; val: unknown; op: "eq" | "in" }[],
    }

    function filteredRows() {
      let rows = [
        ...((state as Record<string, unknown[]>)[table] ?? []),
      ] as Record<string, unknown>[]
      for (const f of ctx.filters) {
        if (f.op === "eq") rows = rows.filter((r) => r[f.col] === f.val)
        if (f.op === "in" && Array.isArray(f.val)) {
          const set = new Set(f.val as unknown[])
          rows = rows.filter((r) => set.has(r[f.col]))
        }
      }
      return rows
    }

    const api = {
      select() {
        return api
      },
      eq(col: string, val: unknown) {
        ctx.filters.push({ col, val, op: "eq" })
        return api
      },
      in(col: string, val: unknown) {
        ctx.filters.push({ col, val, op: "in" })
        return api
      },
      order() {
        return api
      },
      maybeSingle: async () => {
        const rows = filteredRows()
        return { data: rows[0] ?? null, error: null }
      },
      then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve({ data: filteredRows(), error: null }).then(
          onFulfilled,
        )
      },
    }
    return api
  }

  return { from: buildChain }
}

vi.mock("@/lib/supabase", () => ({
  supabase: createMockSupabase(),
}))

vi.mock("@/lib/project-resolution", () => ({
  contextFromIds: vi.fn(async (orgId: string, projectId: string) => ({
    organisationId: orgId,
    projectId,
    apiKeyId: null,
    settings: { projectType: "gatekeeper", flowConfig: null, raw: {} },
  })),
}))

describe("listPlaygroundProjects", () => {
  it("returns all projects for platform actor", async () => {
    const { listPlaygroundProjects } = await import("@/lib/playground-projects")
    const actor: AdminActor = { kind: "platform", email: "ops@example.com" }
    const list = await listPlaygroundProjects(actor)
    expect(list).toHaveLength(2)
  })

  it("scopes member to their org projects only", async () => {
    const { listPlaygroundProjects } = await import("@/lib/playground-projects")
    const actor: AdminActor = {
      kind: "member",
      userId: "user-1",
      email: "m@example.com",
    }
    const list = await listPlaygroundProjects(actor)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe("proj-a")
    expect(list[0].organisationName).toBe("Alpha")
  })
})

describe("resolvePlaygroundProjectContext", () => {
  it("allows platform to resolve any project", async () => {
    const { resolvePlaygroundProjectContext } = await import(
      "@/lib/playground-projects"
    )
    const actor: AdminActor = { kind: "platform", email: "ops@example.com" }
    const r = await resolvePlaygroundProjectContext(actor, "proj-b")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.context.projectId).toBe("proj-b")
  })

  it("forbids member from other org project", async () => {
    const { resolvePlaygroundProjectContext } = await import(
      "@/lib/playground-projects"
    )
    const actor: AdminActor = {
      kind: "member",
      userId: "user-1",
      email: "m@example.com",
    }
    const r = await resolvePlaygroundProjectContext(actor, "proj-b")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })
})
