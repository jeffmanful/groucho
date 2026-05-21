import { describe, expect, it, vi } from "vitest"

function createMockSupabase() {
  const state = {
    organisations: [
      { id: "org-a", name: "Alpha", slug: "alpha" },
      { id: "org-b", name: "Beta", slug: "beta" },
    ],
    projects: [
      {
        id: "proj-1",
        name: "P1",
        slug: "p1",
        organisation_id: "org-a",
        settings: {
          project_type: "onboarding",
          environment: "test",
          session_mode: "dry-run",
        },
        created_at: "2026-01-01",
      },
    ],
    organisation_members: [
      { organisation_id: "org-a", user_id: "user-1", role: "member" },
    ],
    sessions: [
      {
        id: "sess-1",
        session_id: "client-1",
        project_id: "proj-1",
        status: "active",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
  }

  function buildChain(table: string) {
    const ctx = {
      table,
      filters: [] as { col: string; val: unknown; op: "eq" | "in" }[],
      order: null as { col: string; asc: boolean } | null,
      limit: null as number | null,
      single: false,
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
      order(col: string, opts?: { ascending?: boolean }) {
        ctx.order = { col, asc: opts?.ascending ?? true }
        return api
      },
      limit(n: number) {
        ctx.limit = n
        return api
      },
      maybeSingle: async () => {
        if (ctx.table === "organisation_members") {
          const org = ctx.filters.find((f) => f.col === "organisation_id")?.val
          const user = ctx.filters.find((f) => f.col === "user_id")?.val
          const row = state.organisation_members.find(
            (m) => m.organisation_id === org && m.user_id === user,
          )
          return { data: row ? { role: row.role } : null, error: null }
        }
        return { data: null, error: null }
      },
      then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
        let rows = [
          ...((state as Record<string, unknown[]>)[ctx.table] ?? []),
        ] as Record<string, unknown>[]

        for (const f of ctx.filters) {
          if (f.op === "eq") {
            rows = rows.filter((r) => r[f.col] === f.val)
          }
          if (f.op === "in" && Array.isArray(f.val)) {
            const set = new Set(f.val as unknown[])
            rows = rows.filter((r) => set.has(r[f.col]))
          }
        }

        if (ctx.order) {
          const { col, asc } = ctx.order
          rows.sort((a, b) => {
            const av = String(a[col] ?? "")
            const bv = String(b[col] ?? "")
            return asc ? av.localeCompare(bv) : bv.localeCompare(av)
          })
        }
        if (ctx.limit != null) rows = rows.slice(0, ctx.limit)

        return Promise.resolve({ data: rows, error: null }).then(onFulfilled)
      },
    }
    return api
  }

  return {
    from(table: string) {
      return buildChain(table)
    },
  }
}

vi.mock("@/lib/supabase", () => ({
  supabase: createMockSupabase(),
}))

describe("buildAdminOverview", () => {
  it("platform actor sees all organisations and can create projects", async () => {
    const { buildAdminOverview } = await import("@/lib/admin-overview")
    const payload = await buildAdminOverview({
      kind: "platform",
      email: "ops@example.com",
    })

    expect(payload.stats.organisations).toBe(2)
    expect(payload.stats.projects).toBe(1)
    expect(payload.stats.activeSessions).toBe(1)
    expect(payload.organisations.every((o) => o.canCreateProject)).toBe(true)
    const alpha = payload.organisations.find((o) => o.id === "org-a")
    expect(alpha?.projects[0].projectType).toBe("onboarding")
  })

  it("member actor is scoped to membership orgs only", async () => {
    const { buildAdminOverview } = await import("@/lib/admin-overview")
    const payload = await buildAdminOverview({
      kind: "member",
      userId: "user-1",
      email: "member@example.com",
    })

    expect(payload.stats.organisations).toBe(1)
    expect(payload.organisations[0].id).toBe("org-a")
    expect(payload.organisations[0].canCreateProject).toBe(false)
  })
})
