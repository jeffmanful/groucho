import { describe, expect, it, vi, beforeEach } from "vitest"

type FakeRow = Record<string, unknown>

function jsonFromResponse(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

// --- Module mocks (no DB, no network) ---
vi.mock("@/lib/project-resolution", () => ({
  resolveProjectContext: vi.fn(async () => ({
    ok: true,
    context: {
      organisationId: "org1",
      projectId: "proj1",
      apiKeyId: "key1",
      settings: {
        projectType: "gatekeeper" as const,
        applicationExperience: { opening_message: "Hi." },
        flowConfig: null,
        onboardingExperience: {
          bridge_enabled: true,
          followup_enabled: true,
          boundary_enabled: true,
          personalized_completion: true,
        },
        raw: { project_type: "gatekeeper" },
      },
    },
  })),
  touchApiKeyLastUsed: vi.fn(),
}))

vi.mock("@/lib/scoring", () => ({
  scoreMessage: vi.fn(async () => ({
    specificity: 0.5,
    authenticity: 0.5,
    cultural_depth: 0.5,
    overall: 0.5,
  })),
}))

const recordVerdictMock = vi.fn().mockResolvedValue({ profile: null })

vi.mock("@/lib/verdict-webhook", () => ({
  recordVerdictAndEnqueueWebhooks: (...args: unknown[]) => recordVerdictMock(...args),
}))

// Anthropic is used in two places; we mock the constructor + messages.create
// and allow tests to override behaviour via a shared function.
let anthropicCreateImpl: (args: unknown) => Promise<unknown> = async () => ({
  content: [
    {
      type: "tool_use",
      id: "toolu_default",
      name: "groucho_respond",
      input: { reply: "REDIRECT", terminal: "redirect" },
    },
  ],
})

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class Anthropic {
      messages = {
        create: (args: unknown) => anthropicCreateImpl(args),
      }
    },
  }
})

function makeSupabaseMock(state: {
  sessions: FakeRow[]
  messages: FakeRow[]
  personas: FakeRow[]
}) {
  const chain = {
    _table: "" as string,
    _filters: [] as { col: string; val: unknown; op: "eq" | "is" }[],
    from(table: string) {
      this._table = table
      this._filters = []
      return this
    },
    select(_cols?: string) {
      return this
    },
    eq(col: string, val: unknown) {
      this._filters.push({ col, val, op: "eq" })
      return this
    },
    is(col: string, val: unknown) {
      this._filters.push({ col, val, op: "is" })
      return this
    },
    order(_col: string, _opts?: unknown) {
      return this
    },
    range() {
      return this
    },
    single() {
      return this.maybeSingle().then((r: any) => {
        if (!r.data) return { data: null, error: { code: "PGRST116" } }
        return r
      })
    },
    maybeSingle: async function () {
      const table = this._table
      const rows = (state as any)[table] as FakeRow[] | undefined
      if (!rows) return { data: null, error: null }

      const filtered = rows.filter((row) =>
        this._filters.every((f: any) => {
          if (f.op === "eq") return (row as any)[f.col] === f.val
          if (f.op === "is") return (row as any)[f.col] === f.val
          return true
        }),
      )
      return { data: filtered[0] ?? null, error: null }
    },
    insert: function (payload: any) {
      const table = this._table
      if (table === "sessions") {
        const id = `s_${state.sessions.length + 1}`
        state.sessions.push({
          id,
          session_id: payload.session_id,
          project_id: payload.project_id,
          organisation_id: payload.organisation_id,
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        })
        return {
          select: () => ({
            single: async () => ({ data: { id }, error: null }),
          }),
        }
      }
      if (table === "messages") {
        const id = `m_${state.messages.length + 1}`
        state.messages.push({ id, ...payload })
        return {
          select: () => ({
            single: async () => ({ data: { id }, error: null }),
          }),
        }
      }
      return { select: () => ({ single: async () => ({ data: null, error: null }) }) }
    },
    update: function (_payload: any) {
      return this
    },
  }
  return chain
}

vi.mock("@/lib/supabase", () => {
  const state = {
    sessions: [] as FakeRow[],
    messages: [] as FakeRow[],
    personas: [
      {
        id: "persona1",
        prompt: "x",
        pass_threshold: 0.65,
        reject_threshold: 0.25,
        profile_schema: null,
        profile_extractor_hint: null,
        is_active: true,
        is_default: true,
      },
    ],
  }
  return {
    supabase: makeSupabaseMock(state),
    __state: state,
  }
})

describe("contract: postSessionMessage", () => {
  beforeEach(() => {
    process.env.GROUCHO_RL_API_KEY_PER_MINUTE = "1000"
    process.env.GROUCHO_RL_SESSION_PER_MINUTE = "1000"
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_default",
          name: "groucho_respond",
          input: { reply: "REDIRECT", terminal: "redirect" },
        },
      ],
    })
    recordVerdictMock.mockReset().mockResolvedValue({ profile: null })
  })

  it("forwards persona + transcript to verdict and surfaces profile in response", async () => {
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_pass",
          name: "groucho_respond",
          input: { reply: "Yeah. Here.", terminal: "pass" },
        },
      ],
    })
    recordVerdictMock.mockResolvedValueOnce({
      profile: {
        schema_version: 1,
        core: null,
        custom: null,
        extraction: { model: "m", status: "ok" },
      },
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_profile_path_1",
      message: "hello",
    })
    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as any)
    expect(body.profile).toBeTruthy()
    expect(recordVerdictMock).toHaveBeenCalled()
    const [opts] = recordVerdictMock.mock.calls[0] as [Record<string, unknown>]
    expect(opts.persona).toBeTruthy()
    expect(Array.isArray(opts.transcript)).toBe(true)
  })

  it("200: returns message/status/scores", async () => {
    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_12345678",
      message: "hello",
    })
    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as any)
    expect(body.message).toBe("REDIRECT")
    expect(body.status).toBe("redirected")
    expect(body.scores).toEqual({
      specificity: 0.5,
      authenticity: 0.5,
      cultural_depth: 0.5,
      overall: 0.5,
    })
  })

  it("409: session concluded", async () => {
    const supa = await import("@/lib/supabase")
    ;(supa as any).__state.sessions.push({
      id: "s1",
      session_id: "sess_concluded",
      project_id: "proj1",
      status: "passed",
    })
    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_concluded",
      message: "hello",
    })
    expect(res.status).toBe(409)
    const body = await jsonFromResponse(res as any)
    expect(body.error).toBeTruthy()
  })

  it("503: LLM unavailable", async () => {
    anthropicCreateImpl = async () => {
      throw new Error("boom")
    }

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_12345679",
      message: "hello",
    })
    expect(res.status).toBe(503)
    const body = await jsonFromResponse(res as any)
    expect(body.error).toBeTruthy()
  })

  it("429: rate limit per session", async () => {
    process.env.GROUCHO_RL_API_KEY_PER_MINUTE = "1000"
    process.env.GROUCHO_RL_SESSION_PER_MINUTE = "2"

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const base = {
      authorization: "Bearer gk_test_x",
      sessionId: "sess_rl_12345678",
      message: "hello",
    }
    expect((await postSessionMessage(base as any)).status).toBe(200)
    expect((await postSessionMessage(base as any)).status).toBe(200)
    const res3 = await postSessionMessage(base as any)
    expect(res3.status).toBe(429)
  })
})

