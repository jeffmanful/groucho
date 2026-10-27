import { describe, expect, it, vi } from "vitest"
import { createGrouchoRelay } from "../relay.js"
import { createClient } from "../client.js"

function upstream() {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json", "content-encoding": "gzip" } }),
  )
}

describe("createGrouchoRelay", () => {
  it("forwards the applicant's connection and strips anything the browser claimed", async () => {
    const fetch = upstream()
    const relay = createGrouchoRelay({ baseUrl: "https://groucho.test/", apiKey: "gk_live_x", fetch })
    const request = new Request("https://brand.test/api/groucho/v1/sessions/abc/messages?x=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 Test",
        "accept-language": "en-GB",
        "x-vercel-forwarded-for": "203.0.113.9",
        "x-forwarded-for": "198.51.100.1",
        cookie: "brand_session=secret",
        authorization: "Bearer browser",
        "x-groucho-applicant-ip": "1.1.1.1",
      },
      body: JSON.stringify({ message: "hi" }),
    })
    const res = await relay(request, ["v1", "sessions", "abc", "messages"])
    expect(res.status).toBe(201)
    expect(res.headers.get("content-encoding")).toBeNull()
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe("https://groucho.test/v1/sessions/abc/messages?x=1")
    const sent = new Headers(init!.headers)
    expect(sent.get("authorization")).toBe("Bearer gk_live_x")
    expect(sent.get("x-groucho-applicant-ip")).toBe("203.0.113.9")
    expect(sent.get("x-groucho-applicant-user-agent")).toBe("Mozilla/5.0 Test")
    expect(sent.get("x-groucho-applicant-language")).toBe("en-GB")
    expect(sent.get("cookie")).toBeNull()
  })

  it("uses clientIp when given", async () => {
    const fetch = upstream()
    const relay = createGrouchoRelay({ baseUrl: "https://groucho.test", apiKey: "k", fetch, clientIp: () => "192.0.2.5" })
    await relay(new Request("https://brand.test/x", { method: "POST", body: "{}", headers: { "x-forwarded-for": "6.6.6.6" } }), "v1/entries")
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get("x-groucho-applicant-ip")).toBe("192.0.2.5")
  })

  it("only reaches applicant-facing endpoints", async () => {
    const fetch = upstream()
    const relay = createGrouchoRelay({ baseUrl: "https://groucho.test", apiKey: "k", fetch })
    const get = (path: string | string[]) => relay(new Request("https://brand.test/x"), path)
    expect((await get("v1/applications")).status).toBe(404)
    expect((await get(["v1", "sessions", "..", "..", "v1", "applications"])).status).toBe(404)
    expect((await get(["v1", "sessions", "a%2F..%2Fb"])).status).toBe(404)
    expect((await get(["v1", "sessions", "%E0%A4%A"])).status).toBe(404)
    expect((await get("v1/cohorts")).status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
    expect((await get("v1/sessions/abc")).status).toBe(201)
  })
})

describe("client applicant option", () => {
  it("adds the applicant headers to calls made from your server", async () => {
    const fetch = upstream()
    const client = createClient({ baseUrl: "https://groucho.test", apiKey: "k", fetch })
    await client.submitEntry({ sessionId: "entry-0001", applicant: { email: "a@b.co" } }, { applicant: { ip: "203.0.113.9", userAgent: "UA\r\nInjected: 1" } })
    const sent = new Headers(fetch.mock.calls[0]![1]!.headers)
    expect(sent.get("x-groucho-applicant-ip")).toBe("203.0.113.9")
    expect(sent.get("x-groucho-applicant-user-agent")).toBe("UA  Injected: 1")
  })
})
