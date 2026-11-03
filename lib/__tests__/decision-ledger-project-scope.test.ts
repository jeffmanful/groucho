import { describe, expect, it, vi } from "vitest"

const from = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase", () => ({ supabase: { from } }))

describe("decision ledger project scope", () => {
  it("returns no decisions instead of widening an invalid project to the whole organisation", async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({ data: [{ id: "a", name: "Project A" }], error: null }),
    }
    from.mockReturnValue(chain)
    const { buildDecisionLedger } = await import("@/lib/decision-ledger")
    const result = await buildDecisionLedger("colors", new URLSearchParams({ project: "foreign" }))
    expect(result.total).toBe(0)
    expect(result.entries).toEqual([])
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith("projects")
  })
})
