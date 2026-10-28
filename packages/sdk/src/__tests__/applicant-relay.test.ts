import { describe, expect, it, vi } from "vitest"
import { createGrouchoApplicantRelay } from "../applicant-relay.js"

const id = "11111111-2222-4333-8444-555555555555"
const path = ["v1", "sessions", id]
const base = `https://forum.test/api/groucho/forum/v1/sessions/${id}`
const request = (action: string, body: unknown, cookie?: string) => new Request(`${base}/${action}`, {
  method: "POST", headers: { "content-type": "application/json", origin: "https://forum.test", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
})
function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
    if (init?.method === "GET") return Response.json({ error: "Not found" }, { status: 404 })
    return Response.json({ message: "Why join?", status: "active", reviewerReport: { private: true }, profile: { private: true }, secret: "private", suitabilityScore: 0.9, scores: { overall: 0.9 } })
  })
  return { fetch, relay: createGrouchoApplicantRelay({ baseUrl: "https://groucho.test", apiKey: "server-conversations-key", cookiePath: "/api/groucho/forum", fetch }) }
}

describe("browser-bound applicant relay", () => {
  it("issues an HTTP-only cookie for a new session and omits all private assessment fields", async () => {
    const { relay, fetch } = setup()
    const response = await relay(request("start", { applicant: { email: "synthetic@example.test" }, personaId: "override", openingMessage: "Override" }), [...path, "start"])
    expect(await response.json()).toEqual({ message: "Why join?", status: "active" })
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax")
    expect(response.headers.get("set-cookie")).toContain("Path=/api/groucho/forum")
    expect(response.headers.get("set-cookie")).toContain("Secure")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(JSON.parse(new TextDecoder().decode(fetch.mock.calls[1][1]?.body as ArrayBuffer))).toEqual({ applicant: { email: "synthetic@example.test" } })
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("cookie")).toBeNull()
  })

  it("binds an invitation to its assigned session, supports restoration, and injects only the host-validated token", async () => {
    const { fetch } = setup()
    const relay = createGrouchoApplicantRelay({ baseUrl: "https://groucho.test", apiKey: "server-key", cookiePath: "/api/groucho/forum", fetch, invitation: { token: "validated-private-token", sessionId: id } })
    const otherPath = ["v1", "sessions", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
    expect((await relay(new Request(base), otherPath)).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
    await relay(request("start", { applicant: { email: "invited@example.test" }, invitationToken: "browser-override" }), [...path, "start"])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(new TextDecoder().decode(fetch.mock.calls[0][1]?.body as ArrayBuffer))).toEqual({ applicant: { email: "invited@example.test" }, invitationToken: "validated-private-token" })
    fetch.mockResolvedValueOnce(Response.json({ status: "completed", applicant: { email: "invited@example.test" }, reviewerReport: { secret: true }, message: "Thank you" }))
    const restored = await relay(new Request(base), path)
    expect(await restored.json()).toEqual({ status: "completed", applicant: { email: "invited@example.test" }, message: "Thank you" })
  })

  it("cannot adopt an existing upstream session without its cookie", async () => {
    const { relay, fetch } = setup()
    fetch.mockResolvedValueOnce(Response.json({ status: "active", applicant: { email: "someone-else@example.test" } }))
    const response = await relay(request("start", {}), [...path, "start"])
    expect(response.status).toBe(403)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await response.text()).not.toContain("someone-else")
  })

  it("requires ownership for messages and reads, including guessed UUIDs", async () => {
    const { relay, fetch } = setup()
    expect((await relay(request("messages", { message: "Hello" }), [...path, "messages"])).status).toBe(401)
    expect((await relay(new Request(base), path)).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("permits the owner to continue, strips overrides and replaces real scores with neutral placeholders", async () => {
    const { relay, fetch } = setup()
    const started = await relay(request("start", {}), [...path, "start"])
    const cookie = started.headers.get("set-cookie")!.split(";")[0]
    const response = await relay(request("messages", { message: "Hello", applicant: { email: "override@example.test" }, personaId: "override" }, cookie), [...path, "messages"])
    const body = await response.json()
    expect(body).toEqual({ message: "Why join?", status: "active", scores: { specificity: 0.5, authenticity: 0.5, cultural_depth: 0.5, overall: 0.5 } })
    expect(JSON.parse(new TextDecoder().decode(fetch.mock.calls.at(-1)![1]?.body as ArrayBuffer))).toEqual({ message: "Hello" })
    const other = [...path]; other[2] = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    expect((await relay(new Request(base, { headers: { cookie } }), other)).status).toBe(401)
    const differentProject = createGrouchoApplicantRelay({ baseUrl: "https://groucho.test", apiKey: "other-key", cookiePath: "/api/groucho/forum", fetch })
    expect((await differentProject(new Request(base, { headers: { cookie } }), path)).status).toBe(401)
  })

  it("does not forward internal API paths, traversal, arbitrary methods or cross-origin requests", async () => {
    const { relay, fetch } = setup()
    for (const bad of [["v1", "applications"], ["v1", "sessions", id, "access"], ["v1", "sessions", "%2e%2e"], [...path, "messages", "extra"]]) {
      expect((await relay(new Request(base), bad)).status).toBe(404)
    }
    expect((await relay(new Request(base, { method: "DELETE" }), path)).status).toBe(404)
    expect((await relay(new Request(`${base}/start`, { method: "POST", headers: { origin: "https://other.test" } }), [...path, "start"])).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("turns provider/HTML failures into a retryable error without forwarding the response", async () => {
    const { relay, fetch } = setup()
    fetch.mockRejectedValueOnce(new Error("sensitive internal detail"))
    const response = await relay(request("start", {}), [...path, "start"])
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain("sensitive")
  })
})
