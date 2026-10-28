import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin-actor", () => ({ resolveAdminActor: vi.fn() }))
vi.mock("@/lib/admin-colors-assessment", () => ({ assessColorsApplication: vi.fn() }))
vi.mock("@/lib/org-access", () => ({ requireOrgAdmin: vi.fn(), unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }) }))

import { resolveAdminActor } from "@/lib/admin-actor"
import { assessColorsApplication } from "@/lib/admin-colors-assessment"
import { requireOrgAdmin } from "@/lib/org-access"
import { POST } from "@/app/api/admin/organisations/[orgId]/projects/[projectId]/sessions/[sessionId]/assessment/route"

const params = { params: Promise.resolve({ orgId: "org", projectId: "project", sessionId: "session" }) }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireOrgAdmin).mockResolvedValue(null); vi.mocked(assessColorsApplication).mockResolvedValue({ status: "ready" }) })

describe("admin assessment permissions", () => {
  it("rejects cross-origin assessment requests", async () => {
    expect((await POST(new Request("https://groucho.test", { headers: { origin: "https://another.test" } }), params)).status).toBe(403)
    expect(assessColorsApplication).not.toHaveBeenCalled()
  })
  it("rejects anonymous requests before assessment work", async () => {
    vi.mocked(resolveAdminActor).mockResolvedValue(null)
    expect((await POST(new Request("https://groucho.test"), params)).status).toBe(401)
    expect(assessColorsApplication).not.toHaveBeenCalled()
  })
  it("rejects readers and members of other organisations before assessment work", async () => {
    vi.mocked(resolveAdminActor).mockResolvedValue({ kind: "member", userId: "reader", email: null })
    vi.mocked(requireOrgAdmin).mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }) as never)
    expect((await POST(new Request("https://groucho.test"), params)).status).toBe(403)
    expect(assessColorsApplication).not.toHaveBeenCalled()
  })
  it("passes the authenticated organisation scope and returns pending for an existing assessment", async () => {
    vi.mocked(resolveAdminActor).mockResolvedValue({ kind: "member", userId: "admin", email: "admin@example.test" })
    vi.mocked(assessColorsApplication).mockResolvedValue({ status: "pending" })
    expect((await POST(new Request("https://groucho.test"), params)).status).toBe(202)
    expect(requireOrgAdmin).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin" }), "org")
    expect(assessColorsApplication).toHaveBeenCalledWith(expect.objectContaining({ organisationId: "org", projectId: "project", sessionId: "session" }))
  })
})
