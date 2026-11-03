import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({ projectRoute: vi.fn(), failedDeliveries: vi.fn() }))
vi.mock("@/lib/admin-project-route", () => ({
  projectRoute: mocks.projectRoute,
  serverError: () => NextResponse.json({ error: "Database error" }, { status: 500 }),
}))
vi.mock("@/lib/needs-you", () => ({ failedDeliveries: mocks.failedDeliveries }))

describe("project delivery failures", () => {
  beforeEach(() => {
    mocks.projectRoute.mockResolvedValue({ ok: true, value: { orgId: "colors", projectId: "b" } })
    mocks.failedDeliveries.mockResolvedValue([])
  })

  it("loads only the authorised project's failures for the last 30 days", async () => {
    const { GET } = await import("@/app/api/admin/organisations/[orgId]/projects/[projectId]/delivery-failures/route")
    const before = Date.now()
    const response = await GET(new Request("http://localhost/failures"), { params: Promise.resolve({ orgId: "colors", projectId: "b" }) })
    expect(response.status).toBe(200)
    expect(mocks.projectRoute).toHaveBeenCalledWith(expect.any(Promise), "member")
    expect(mocks.failedDeliveries).toHaveBeenCalledWith(["b"], expect.any(String))
    const since = Date.parse(mocks.failedDeliveries.mock.calls[0][1])
    expect(since).toBeGreaterThanOrEqual(before - 30 * 86_400_000)
    expect(since).toBeLessThanOrEqual(Date.now() - 30 * 86_400_000)
  })

  it("does not query deliveries when the project is outside the organisation", async () => {
    mocks.projectRoute.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) })
    const { GET } = await import("@/app/api/admin/organisations/[orgId]/projects/[projectId]/delivery-failures/route")
    const response = await GET(new Request("http://localhost/failures"), { params: Promise.resolve({ orgId: "colors", projectId: "foreign" }) })
    expect(response.status).toBe(404)
    expect(mocks.failedDeliveries).not.toHaveBeenCalled()
  })
})
