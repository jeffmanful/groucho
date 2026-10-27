import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"
import { createClient } from "../client.js"
import { GrouchoApiError } from "../errors.js"

type CapturedCall = {
  url: string
  init: RequestInit | undefined
}

type FetchMock = Mock<typeof fetch>

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchMock {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  )
}

function requestBody(fetchMock: FetchMock): string {
  const init = fetchMock.mock.calls[0]?.[1]
  if (!init?.body) throw new Error("Expected fetch request body")
  return init.body as string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain" },
  })
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status })
}

describe("createClient — URL composition", () => {
  let calls: CapturedCall[]
  let fakeFetch: FetchMock

  beforeEach(() => {
    calls = []
    fakeFetch = mockFetch(async (url, init) => {
      calls.push({ url, init })
      const isStart = url.endsWith("/start")
      return jsonResponse(
        isStart
          ? {
              message: "Hi.",
              status: "active",
              projectType: "gatekeeper",
              bootstrapped: true,
            }
          : { status: "active", scores: {}, message: "ok" },
      )
    })
  })

  it("strips trailing slash from baseUrl", async () => {
    const client = createClient({ baseUrl: "https://api.example.com/", fetch: fakeFetch })
    await client.sendMessage("abc", { message: "hi" })
    expect(calls[0]!.url).toBe("https://api.example.com/v1/sessions/abc/messages")
  })

  it("preserves a path prefix (proxy mode)", async () => {
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await client.sendMessage("abc", { message: "hi" })
    expect(calls[0]!.url).toBe("/api/groucho/v1/sessions/abc/messages")
  })

  it("encodes session ids", async () => {
    const client = createClient({ baseUrl: "https://api.example.com", fetch: fakeFetch })
    await client.getSession("with/slash and space")
    expect(calls[0]!.url).toBe(
      "https://api.example.com/v1/sessions/with%2Fslash%20and%20space",
    )
  })

  it("routes each method to its endpoint", async () => {
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await client.sendMessage("abc", { message: "hi" })
    await client.getSession("abc")
    await client.submitAccessEmail("abc", { email: "u@example.com" })
    await client.startSession("abc", { applicant: { email: "u@example.com" } })

    expect(calls.map((c) => c.url)).toEqual([
      "/api/groucho/v1/sessions/abc/messages",
      "/api/groucho/v1/sessions/abc",
      "/api/groucho/v1/sessions/abc/access",
      "/api/groucho/v1/sessions/abc/start",
    ])
    expect(calls.map((c) => c.init?.method)).toEqual(["POST", "GET", "POST", "POST"])
  })
})

describe("createClient — headers and body", () => {
  let calls: CapturedCall[]
  let fakeFetch: FetchMock

  beforeEach(() => {
    calls = []
    fakeFetch = mockFetch(async (url, init) => {
      calls.push({ url, init })
      const isStart = url.endsWith("/start")
      return jsonResponse(
        isStart
          ? {
              message: "Hi.",
              status: "active",
              projectType: "gatekeeper",
              bootstrapped: true,
            }
          : { status: "active", scores: {}, message: "ok" },
      )
    })
  })

  it("attaches Authorization when apiKey is provided", async () => {
    const client = createClient({
      baseUrl: "https://api.example.com",
      apiKey: "gk_test_abc",
      fetch: fakeFetch,
    })
    await client.sendMessage("abc", { message: "hi" })
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get("Authorization")).toBe("Bearer gk_test_abc")
    expect(headers.get("Content-Type")).toBe("application/json")
  })

  it("omits Authorization in proxy mode (no apiKey)", async () => {
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await client.sendMessage("abc", { message: "hi" })
    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.has("Authorization")).toBe(false)
  })

  it("sends message + personaId (null when omitted)", async () => {
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await client.sendMessage("abc", { message: "hi" })
    const body = JSON.parse(calls[0]!.init?.body as string)
    expect(body).toEqual({ message: "hi", personaId: null })
  })

  it("sends personaId when provided", async () => {
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await client.sendMessage("abc", { message: "hi", personaId: "p1" })
    const body = JSON.parse(calls[0]!.init?.body as string)
    expect(body.personaId).toBe("p1")
  })

  it("sends a structured media choice answer", async () => {
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await client.sendMessage("abc", {
      message: "Ranked: 1. Performance C; 2. Performance A",
      interactionAnswer: {
        type: "mediaChoice",
        questionId: "programme-room",
        mode: "rank",
        optionIds: ["performance-c", "performance-a"],
        rationale: "The contrast creates an arc.",
      },
    })
    const body = JSON.parse(calls[0]!.init?.body as string)
    expect(body.interactionAnswer).toEqual({
      type: "mediaChoice",
      questionId: "programme-room",
      mode: "rank",
      optionIds: ["performance-c", "performance-a"],
      rationale: "The contrast creates an arc.",
    })
  })

  it("omits secret from access body when not provided", async () => {
    const fetchVoid = mockFetch(async () => emptyResponse())
    const client = createClient({ baseUrl: "/api/groucho", fetch: fetchVoid })
    await client.submitAccessEmail("abc", { email: "u@example.com" })
    const body = JSON.parse(requestBody(fetchVoid))
    expect(body).toEqual({ email: "u@example.com" })
    expect("secret" in body).toBe(false)
  })

  it("includes secret in access body when provided", async () => {
    const fetchVoid = mockFetch(async () => emptyResponse())
    const client = createClient({ baseUrl: "/api/groucho", fetch: fetchVoid })
    await client.submitAccessEmail("abc", { email: "u@example.com", secret: "s_1" })
    const body = JSON.parse(requestBody(fetchVoid))
    expect(body).toEqual({ email: "u@example.com", secret: "s_1" })
  })

  it("sends startSession body with personaId and applicant", async () => {
    const fetchStart = mockFetch(async () =>
      jsonResponse({
        message: "Hi.",
        status: "active",
        projectType: "gatekeeper",
        bootstrapped: true,
        resumed: true,
      }),
    )
    const client = createClient({ baseUrl: "/api/groucho", fetch: fetchStart })
    const res = await client.startSession("abc", {
      personaId: "p1",
      applicant: { email: "u@example.com", name: "User" },
    })
    const body = JSON.parse(requestBody(fetchStart))
    expect(body).toEqual({
      personaId: "p1",
      applicant: { email: "u@example.com", name: "User" },
    })
    expect(res.message).toBe("Hi.")
    expect(res.projectType).toBe("gatekeeper")
    expect(res.resumed).toBe(true)
  })

  it("sends openingMessage when provided", async () => {
    const fetchStart = mockFetch(async () =>
      jsonResponse({
        message: "Welcome.",
        status: "active",
        projectType: "gatekeeper",
        bootstrapped: true,
      }),
    )
    const client = createClient({ baseUrl: "/api/groucho", fetch: fetchStart })
    await client.startSession("abc", {
      openingMessage: "Welcome.",
    })
    const body = JSON.parse(requestBody(fetchStart))
    expect(body.openingMessage).toBe("Welcome.")
  })

  it("sends openingInteraction when provided", async () => {
    const fetchStart = mockFetch(async () =>
      jsonResponse({
        message: "Welcome.",
        status: "active",
        projectType: "gatekeeper",
        ui: {
          intent: "probe",
          inputType: "singleSelect",
          emotionalState: "neutral",
          visualState: "curious",
          options: ["Artist", "Curator"],
        },
        bootstrapped: true,
      }),
    )
    const client = createClient({ baseUrl: "/api/groucho", fetch: fetchStart })
    await client.startSession("abc", {
      openingInteraction: {
        inputType: "singleSelect",
        options: ["Artist", "Curator"],
      },
    })
    const body = JSON.parse(requestBody(fetchStart))
    expect(body.openingInteraction).toEqual({
      inputType: "singleSelect",
      options: ["Artist", "Curator"],
    })
  })
})

describe("createClient — error handling", () => {
  it("throws GrouchoApiError with status and JSON body on non-2xx", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({ error: "Session concluded" }, 409),
    )
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    let caught: unknown
    try {
      await client.sendMessage("abc", { message: "hi" })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(GrouchoApiError)
    const err = caught as GrouchoApiError
    expect(err.status).toBe(409)
    expect(err.message).toBe("Session concluded")
    expect(err.body).toEqual({ error: "Session concluded" })
  })

  it("falls back to HTTP <status> message when body is not JSON", async () => {
    const fakeFetch = vi.fn(async () => textResponse("upstream offline", 503))
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await expect(client.getSession("abc")).rejects.toMatchObject({
      name: "GrouchoApiError",
      status: 503,
      message: "HTTP 503",
      body: "upstream offline",
    })
  })

  it("rejects submitAccessEmail with the same error shape", async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ error: "Not eligible" }, 403))
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    await expect(
      client.submitAccessEmail("abc", { email: "u@example.com" }),
    ).rejects.toMatchObject({ status: 403, message: "Not eligible" })
  })
})

describe("createClient — JSON parsing", () => {
  it("returns parsed JSON when content-type is application/json", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({
        message: "Yeah. Here.",
        status: "passed",
        scores: {
          specificity: 0.8,
          authenticity: 0.9,
          cultural_depth: 0.85,
          overall: 0.86,
        },
        secret: "sec_1",
        profile: {
          schema_version: 1,
          core: null,
          custom: null,
          extraction: { model: "m", status: "ok" },
        },
        reviewerReport: {
          applicant_bio: "Runs a small listening session.",
          advisory_recommendation: "recommend",
          confidence_score: 0.82,
          evidence_summary: ["Specific recurring participation"],
          weak_or_missing_signals: [],
          safety_or_integrity_flags: [],
          reviewer_focus: "Confirm first-month contribution capacity.",
        },
      }),
    )
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })
    const res = await client.sendMessage("abc", { message: "hi" })
    expect(res.status).toBe("passed")
    expect(res.profile?.schema_version).toBe(1)
    expect(res.reviewerReport?.advisory_recommendation).toBe("recommend")
  })

  it("throws a useful error when a successful response is not JSON", async () => {
    const fakeFetch = vi.fn(async () => textResponse("ok", 200))
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })

    await expect(client.sendMessage("abc", { message: "hi" })).rejects.toMatchObject({
      name: "GrouchoApiError",
      status: 200,
      message: expect.stringContaining("Expected JSON response"),
    })
  })

  it("throws a useful error when message response JSON has the wrong shape", async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ ok: true }, 200))
    const client = createClient({ baseUrl: "/api/groucho", fetch: fakeFetch })

    await expect(client.sendMessage("abc", { message: "hi" })).rejects.toMatchObject({
      name: "GrouchoApiError",
      status: 200,
      message: "Invalid Groucho API response: missing message or status",
      body: { ok: true },
    })
  })
})

describe("application review", () => {
  it("lists applications with query parameters and the API key", async () => {
    const fakeFetch = mockFetch(async () =>
      jsonResponse({ applications: [], total: 0, counts: {}, offset: 0, limit: 20 }),
    )
    const client = createClient({ baseUrl: "https://groucho.test/", apiKey: "gk_live_x", fetch: fakeFetch })
    await client.listApplications({ queue: "ready_for_review", search: "maya", limit: 20, from: "" })

    const [url, init] = fakeFetch.mock.calls[0]!
    expect(String(url)).toBe("https://groucho.test/v1/applications?queue=ready_for_review&q=maya&limit=20")
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer gk_live_x")
  })

  it("gets one application by the client's session key", async () => {
    const fakeFetch = mockFetch(async () => jsonResponse({ application: {}, reviewerReport: null, transcript: [] }))
    const client = createClient({ baseUrl: "https://groucho.test", apiKey: "gk_live_x", fetch: fakeFetch })
    await client.getApplication("sess/1")
    expect(String(fakeFetch.mock.calls[0]![0])).toBe("https://groucho.test/v1/applications/sess%2F1")
  })

  it("records a decision with the reviewer", async () => {
    const fakeFetch = mockFetch(async () =>
      jsonResponse({ sessionId: "s1", reviewStatus: "declined", decision: { decision: "declined" } }, 201),
    )
    const client = createClient({ baseUrl: "https://groucho.test", apiKey: "gk_live_x", fetch: fakeFetch })
    const res = await client.decideApplication("s1", {
      decision: "declined",
      reason: "Not a fit this season",
      reviewer: { email: "maya@colors.example", name: "Maya" },
    })
    expect(res.reviewStatus).toBe("declined")
    expect(fakeFetch.mock.calls[0]![0]).toBe("https://groucho.test/v1/applications/s1/decision")
    expect(JSON.parse(requestBody(fakeFetch))).toEqual({
      decision: "declined",
      reason: "Not a fit this season",
      reviewer: { email: "maya@colors.example", name: "Maya" },
    })
  })

  it("surfaces the scope error for a conversations key", async () => {
    const fakeFetch = mockFetch(async () => jsonResponse({ error: "This key can run conversations only." }, 403))
    const client = createClient({ baseUrl: "https://groucho.test", apiKey: "gk_live_x", fetch: fakeFetch })
    await expect(client.listApplications()).rejects.toMatchObject({ status: 403, message: "This key can run conversations only." })
  })

  it("corrects a decision and reports outcomes", async () => {
    const fakeFetch = mockFetch(async () => jsonResponse({ ok: true }, 201))
    const client = createClient({ baseUrl: "https://groucho.test", apiKey: "gk_live_x", fetch: fakeFetch })
    await client.correctApplication("s1", { decision: "approved", reason: "Clarified on a call", expectedDecisionId: "d1" })
    await client.reportOutcome("s1", { outcome: "joined", occurredAt: "2026-10-27T10:00:00Z" })
    expect(fakeFetch.mock.calls.map((call) => call[0])).toEqual([
      "https://groucho.test/v1/applications/s1/correction",
      "https://groucho.test/v1/applications/s1/outcomes",
    ])
    expect(JSON.parse(fakeFetch.mock.calls[1]![1]!.body as string)).toEqual({ outcome: "joined", occurredAt: "2026-10-27T10:00:00Z" })
  })

  it("submits entries and places people in cohorts", async () => {
    const fakeFetch = mockFetch(async () => jsonResponse({ ok: true }, 200))
    const client = createClient({ baseUrl: "https://groucho.test/", apiKey: "gk_live_x", fetch: fakeFetch })
    await client.submitEntry({ sessionId: "entry-0001", applicant: { email: "sam@example.com" }, fields: { size: "9" } })
    await client.listCohorts()
    await client.addToCohort("c/1", { sessionIds: ["entry-0001"] })
    expect(fakeFetch.mock.calls.map((call) => [call[0], call[1]!.method])).toEqual([
      ["https://groucho.test/v1/entries", "POST"],
      ["https://groucho.test/v1/cohorts", "GET"],
      ["https://groucho.test/v1/cohorts/c%2F1/members", "POST"],
    ])
    expect(JSON.parse(fakeFetch.mock.calls[2]![1]!.body as string)).toEqual({ sessionIds: ["entry-0001"] })
  })
})
