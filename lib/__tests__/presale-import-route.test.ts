import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/admin/organisations/[orgId]/projects/[projectId]/entries/import/route"
import { applyEntryFilters, parseEntryFilters } from "@/lib/entry-review"

const mocks = vi.hoisted(() => ({ projectRoute: vi.fn(), createEntry: vi.fn() }))
vi.mock("@/lib/admin-project-route", () => ({
  projectRoute: mocks.projectRoute,
  serverError: () => NextResponse.json({ error: "Database error" }, { status: 500 }),
}))
vi.mock("@/lib/entries", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/entries")>(),
  createEntry: mocks.createEntry,
}))

const csv = "registration_id,email,signed_up_at\na,fan@example.test,2026-11-08T10:00:00Z\nb,fan@example.test,2026-11-08T10:00:01Z"

function request(apply: boolean, input = csv) {
  return POST(new Request("https://groucho.test/entries/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv: input, source: "presale", apply }),
  }), { params: Promise.resolve({ orgId: "org", projectId: "project" }) })
}

describe("project entries import", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.projectRoute.mockResolvedValue({ ok: true, value: { orgId: "org", projectId: "project" } })
  })

  it("requires project admin access and validates without writing", async () => {
    const response = await request(false)
    expect(await response.json()).toEqual({ valid: 2 })
    expect(mocks.projectRoute).toHaveBeenCalledWith(expect.any(Promise), "admin")
    expect((await request(true, csv.replace("fan@example.test", "invalid"))).status).toBe(400)
    mocks.projectRoute.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await request(true)).status).toBe(403)
    expect(mocks.createEntry).not.toHaveBeenCalled()
  })

  it("uses stable project-scoped keys on retry without collapsing shared emails", async () => {
    mocks.createEntry
      .mockResolvedValueOnce({ ok: true, created: true })
      .mockResolvedValueOnce({ ok: false, status: 503, error: "Unavailable" })
      .mockResolvedValueOnce({ ok: true, created: false })
      .mockResolvedValueOnce({ ok: true, created: true })

    expect((await request(true)).status).toBe(503)
    expect(await (await request(true)).json()).toEqual({ created: 1, existing: 1 })
    const [first, second, firstRetry, secondRetry] = mocks.createEntry.mock.calls.map(([entry]) => entry)
    expect(first).toMatchObject({
      organisationId: "org",
      projectId: "project",
      entry: { email: "fan@example.test", fields: { signed_up_at: "2026-11-08T10:00:00.000Z" } },
    })
    expect(first.clientSessionKey).not.toBe(second.clientSessionKey)
    expect(firstRetry).toEqual(first)
    expect(secondRetry).toEqual(second)
  })

  it("filters existing submissions for exact-email and disposable-domain flags", () => {
    const query = { eq: vi.fn(), gt: vi.fn(), in: vi.fn(), or: vi.fn() }
    for (const method of Object.values(query)) method.mockReturnValue(query)
    applyEntryFilters(query, parseEntryFilters(new URLSearchParams("tab=approved&emailFlags=1")))
    expect(query.eq).toHaveBeenCalledWith("queue", "approved")
    expect(query.or).toHaveBeenCalledWith("email_matches.gt.1,disposable_email.eq.true")
    applyEntryFilters(query, { ...parseEntryFilters(new URLSearchParams("emailFlags=1")), noFlags: true })
    expect(query.eq).toHaveBeenCalledWith("flag_count", 0)
  })
})
