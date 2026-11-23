import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
import { parseRetentionPolicy } from "@/lib/session-privacy"

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), upsert: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/admin-project-route", () => ({ projectRoute: mocks.access }))
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

import { DELETE, PUT as hold, PATCH as release } from "@/app/api/admin/organisations/[orgId]/projects/[projectId]/sessions/[sessionId]/privacy/route"
import { GET as preview, PUT as policy } from "@/app/api/admin/organisations/[orgId]/projects/[projectId]/privacy/route"
import { GET as drain } from "@/app/api/cron/session-retention/route"

const id = "11111111-1111-4111-8111-111111111111"
const context = { params: Promise.resolve({ orgId: "org", projectId: "project", sessionId: id }) }
const retention = { enabled: false, active_days: 30, abandoned_days: 30, completed_days: 90 }
function request(method: string, body: unknown, origin = "https://groucho.test") {
  return new Request("https://groucho.test/api/admin/privacy", {
    method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.access.mockResolvedValue({ ok: true, value: { orgId: "org", projectId: "project" } })
  mocks.rpc.mockResolvedValue({ data: { receiptId: "receipt" }, error: null })
  mocks.upsert.mockResolvedValue({ error: null })
  mocks.from.mockReturnValue({ upsert: mocks.upsert })
  vi.unstubAllEnvs()
})

describe("privacy route boundaries", () => {
  it("requires an admin and performs no erasure when authentication/tenant checks deny access", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) })
    expect((await DELETE(request("DELETE", { confirmSessionId: id }), context)).status).toBe(403)
    expect(mocks.access).toHaveBeenCalledWith(context.params, "admin")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects cross-origin cookie mutations and mismatched confirmations before erasure", async () => {
    expect((await DELETE(request("DELETE", { confirmSessionId: id }, "https://untrusted.test"), context)).status).toBe(403)
    expect((await DELETE(request("DELETE", { confirmSessionId: "other" }), context)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("scopes deletion using the authenticated project and returns a no-store receipt", async () => {
    const response = await DELETE(request("DELETE", { confirmSessionId: id, orgId: "forged" }), context)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.rpc).toHaveBeenCalledWith("erase_project_session", {
      p_organisation_id: "org", p_project_id: "project", p_session_id: id, p_reason_code: "requested",
    })
    expect(await response.json()).toEqual({ deletion: { receiptId: "receipt" } })
  })

  it("exposes holds and missing migrations without SQL or applicant details", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: "GR423", message: "private detail" } })
    const blocked = await DELETE(request("DELETE", { confirmSessionId: id }), context)
    expect(blocked.status).toBe(423)
    expect(await blocked.text()).not.toContain("private detail")
    mocks.rpc.mockResolvedValueOnce({ error: { code: "PGRST202", message: "private SQL" } })
    expect((await DELETE(request("DELETE", { confirmSessionId: id }), context)).status).toBe(503)
  })

  it("requires bounded explicit retention settings and stores only recognised fields", async () => {
    expect(parseRetentionPolicy({ ...retention, active_days: "30" })).toBeNull()
    expect(parseRetentionPolicy({ ...retention, active_days: 0 })).toBeNull()
    expect(parseRetentionPolicy({ ...retention, completed_days: Infinity })).toBeNull()
    expect((await policy(request("PUT", { enabled: true }), context)).status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect((await policy(request("PUT", { ...retention, project_id: "forged" }), context)).status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ ...retention, project_id: "project" }), { onConflict: "project_id" })
  })

  it("previews a disabled policy without deleting records", async () => {
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: retention, error: null }) }) }) })
    mocks.rpc.mockResolvedValueOnce({ data: [{ session_id: id }], error: null })
    const response = await preview(new Request("https://groucho.test/privacy"), context)
    expect(await response.json()).toMatchObject({ policy: retention, candidates: [{ session_id: id }] })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("session_retention_candidates", { p_project_id: "project", p_limit: 100, p_include_disabled: true })
  })

  it("requires a valid expiring hold and an explicit hold release", async () => {
    expect((await hold(request("PUT", { reasonCode: "legal_claim", expiresAt: "2099-01-01" }), context)).status).toBe(400)
    expect((await hold(request("PUT", { reasonCode: "legal_claim", expiresAt: new Date(Date.now() + 86400_000).toISOString() }), context)).status).toBe(200)
    expect((await release(request("PATCH", { releaseHold: true }), context)).status).toBe(400)
    expect((await release(request("PATCH", { releaseHold: true, confirmSessionId: id }), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_session_privacy_hold", {
      p_organisation_id: "org", p_project_id: "project", p_session_id: id, p_reason_code: null, p_expires_at: null,
    })
  })

  it("fails closed for cron without configuration or the correct secret", async () => {
    vi.stubEnv("CRON_SECRET", "")
    expect((await drain(new Request("https://groucho.test/cron"))).status).toBe(503)
    vi.stubEnv("CRON_SECRET", "test-secret")
    expect((await drain(new Request("https://groucho.test/cron"))).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValueOnce({ data: 2, error: null })
    expect(await (await drain(new Request("https://groucho.test/cron", { headers: { authorization: "Bearer test-secret" } }))).json()).toEqual({ erased: 2 })
    expect(mocks.rpc).toHaveBeenCalledWith("process_session_retention", { p_limit: 100 })
  })
})
