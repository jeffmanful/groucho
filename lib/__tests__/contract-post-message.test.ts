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

const recordVerdictMock = vi.fn().mockResolvedValue({ profile: null })
const testApplicant = { email: "applicant@example.com", name: "Test Applicant" }

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
      input: {
        reply: "REDIRECT",
        terminal: "redirect",
        intent: "redirect",
        inputType: "text",
        emotionalState: "decisive",
        visualState: "decision",
      },
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
    then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
      const table = this._table
      const rows = (state as any)[table] as FakeRow[] | undefined
      if (!rows) {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled)
      }
      const filtered = rows.filter((row) =>
        this._filters.every((f: any) => {
          if (f.op === "eq") return (row as any)[f.col] === f.val
          if (f.op === "is") return (row as any)[f.col] === f.val
          return true
        }),
      )
      return Promise.resolve({ data: filtered, error: null }).then(onFulfilled)
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
  beforeEach(async () => {
    process.env.GROUCHO_RL_API_KEY_PER_MINUTE = "1000"
    process.env.GROUCHO_RL_SESSION_PER_MINUTE = "1000"
    delete process.env.GROUCHO_GATEKEEPER_CONVERSATION_MODEL
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
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions = []
    state.messages = []
  })

  it("forwards persona + transcript to verdict and surfaces profile in response", async () => {
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_pass",
          name: "groucho_respond",
          input: {
            reply: "Yeah. Here.",
            terminal: "pass",
            intent: "decide",
            inputType: "text",
            emotionalState: "decisive",
            visualState: "decision",
          },
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
      applicantIdentity: testApplicant,
    })
    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as any)
    expect(body.profile).toBeTruthy()
    expect(body.message).toBe("Thank you. We'll get in touch about your application soon.")
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
      applicantIdentity: testApplicant,
    })
    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as any)
    expect(body.message).toBe("Thank you. We'll get in touch about your application soon.")
    expect(body.status).toBe("redirected")
    expect(body.ui).toEqual({
      intent: "redirect",
      inputType: "text",
      emotionalState: "decisive",
      visualState: "decision",
    })
    expect(body.scores).toEqual({
      specificity: 0.5,
      authenticity: 0.5,
      cultural_depth: 0.5,
      overall: 0.5,
    })
  })

  it("uses accumulated scores from the main structured response without a scoring call", async () => {
    let modelCalls = 0
    let capturedRequest: Record<string, unknown> | null = null
    anthropicCreateImpl = async (args: unknown) => {
      modelCalls += 1
      capturedRequest = args as Record<string, unknown>
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_assessment",
            name: "groucho_respond",
            input: {
              reply: "What stayed with you about it?",
              terminal: "none",
              intent: "probe",
              inputType: "text",
              emotionalState: "curious",
              visualState: "curious",
              scores: {
                specificity: 0.72,
                authenticity: 0.81,
                cultural_depth: 0.64,
                overall: 0.73,
              },
            },
          },
        ],
      }
    }

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_structured_scores_1",
      message: "I sent it to a friend who needed something quiet.",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res as any)

    expect(modelCalls).toBe(1)
    expect(capturedRequest).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
    })
    expect(body.status).toBe("active")
    expect(body.scores).toEqual({
      specificity: 0.72,
      authenticity: 0.81,
      cultural_depth: 0.64,
      overall: 0.73,
    })
  })

  it("uses configured neutral closing copy on terminal turns", async () => {
    const { resolveProjectContext } = await import("@/lib/project-resolution")
    vi.mocked(resolveProjectContext).mockResolvedValueOnce({
      ok: true,
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: "key1",
        settings: {
          projectType: "gatekeeper" as const,
          applicationExperience: {
            opening_message: "What brought you here?",
            closing_message: "Thanks. We will get in touch about your application soon.",
          },
          flowConfig: null,
          onboardingExperience: {
            bridge_enabled: false,
            followup_enabled: true,
            boundary_enabled: false,
            personalized_completion: false,
          },
          raw: { project_type: "gatekeeper" },
        },
      },
    })
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_pass",
          name: "groucho_respond",
          input: {
            reply: "Welcome in.",
            terminal: "pass",
            intent: "decide",
            inputType: "text",
            emotionalState: "decisive",
            visualState: "decision",
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_custom_close_1",
      message: "hello",
      applicantIdentity: testApplicant,
    })
    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as any)
    expect(body.status).toBe("passed")
    expect(body.message).toBe(
      "Thanks. We will get in touch about your application soon.",
    )
  })

  it("400: new public sessions require applicant email", async () => {
    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_missing_applicant",
      message: "hello",
    })
    expect(res.status).toBe(400)
    const body = await jsonFromResponse(res as any)
    expect(body.error).toBe("applicant.email is required to start a session")
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
      applicantIdentity: testApplicant,
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
      applicantIdentity: testApplicant,
    }
    expect((await postSessionMessage(base as any)).status).toBe(200)
    expect((await postSessionMessage(base as any)).status).toBe(200)
    const res3 = await postSessionMessage(base as any)
    expect(res3.status).toBe(429)
  })

  it("does not duplicate gatekeeper opener in Claude history after persisted start", async () => {
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_boot",
      session_id: "sess_bootstrapped_1",
      project_id: "proj1",
      status: "active",
    })
    state.messages.push({
      id: "m_opener",
      session_id: "s_boot",
      role: "assistant",
      content: "Hi.",
    })

    let capturedMessages: unknown[] | undefined
    anthropicCreateImpl = async (args: unknown) => {
      capturedMessages = (args as { messages?: unknown[] }).messages
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_default",
            name: "groucho_respond",
            input: {
              reply: "Tell me more.",
              terminal: "none",
              intent: "probe",
              inputType: "text",
              emotionalState: "curious",
              visualState: "curious",
            },
          },
        ],
      }
    }

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_bootstrapped_1",
      message: "hello",
      applicantIdentity: testApplicant,
    })
    expect(res.status).toBe(200)
    expect(capturedMessages).toEqual([
      { role: "assistant", content: "Hi." },
      { role: "user", content: "hello" },
    ])
  })

  it("includes application experience guidance in the gatekeeper system prompt", async () => {
    const { resolveProjectContext } = await import("@/lib/project-resolution")
    vi.mocked(resolveProjectContext).mockResolvedValueOnce({
      ok: true,
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: "key1",
        settings: {
          projectType: "gatekeeper" as const,
          applicationExperience: {
            opening_message: "Hi.",
            required_signals: ["intent", "contribution"],
            preferred_input_types: ["text", "singleSelect"],
            max_turns: 4,
          },
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
    })

    let capturedSystem = ""
    let capturedMessages: Array<{ role: string; content: string }> = []
    anthropicCreateImpl = async (args: unknown) => {
      capturedSystem = (args as { system?: string }).system ?? ""
      capturedMessages =
        (args as { messages?: Array<{ role: string; content: string }> })
          .messages ?? []
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_default",
            name: "groucho_respond",
            input: {
              reply: "Tell me more.",
              terminal: "none",
              intent: "probe",
              inputType: "text",
              emotionalState: "curious",
              visualState: "curious",
              nextSignalKey: "contribution",
            },
          },
        ],
      }
    }

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_app_config_prompt_1",
      message: "hello",
      applicantIdentity: testApplicant,
    })
    expect(res.status).toBe(200)
    expect(capturedSystem).toContain("APPLICATION CONFIGURATION")
    expect(capturedSystem).toContain("- intent")
    expect(capturedSystem).toContain("- contribution")
    expect(capturedSystem).toContain("Preferred input types")
    expect(capturedSystem).toContain("Target maximum assistant turns before decision: 4")
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]?.role).toBe("user")
    expect(capturedMessages[0]?.content).toContain("compact application state")
    expect(capturedMessages[0]?.content).toContain('"intent"')
    expect(capturedMessages[0]?.content).toContain('"status": "answered"')
  })

  it("does not enrich artist references on the applicant response path", async () => {
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_artist",
      session_id: "sess_artist_ref_1",
      project_id: "proj1",
      status: "active",
    })
    state.messages.push(
      {
        id: "m_opener",
        session_id: "s_artist",
        role: "assistant",
        content: "Name an artist whose work feels closest to what you care about.",
      },
      {
        id: "m_user_prev",
        session_id: "s_artist",
        role: "user",
        content: "hello",
      },
      {
        id: "m_followup",
        session_id: "s_artist",
        role: "assistant",
        content: "Name an artist whose work feels closest to what you care about.",
      },
    )

    let modelCalls = 0
    let capturedSystem = ""
    anthropicCreateImpl = async (args: unknown) => {
      modelCalls += 1
      capturedSystem = (args as { system?: string }).system ?? ""
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_artist",
            name: "groucho_respond",
            input: {
              reply: "What about her work feels personal to you?",
              terminal: "none",
              intent: "probe",
              inputType: "text",
              emotionalState: "curious",
              visualState: "curious",
              scores: {
                specificity: 0.6,
                authenticity: 0.7,
                cultural_depth: 0.6,
                overall: 0.64,
              },
            },
          },
        ],
      }
    }

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_artist_ref_1",
      message: "FKA twigs",
      applicantIdentity: testApplicant,
    })
    expect(res.status).toBe(200)
    expect(modelCalls).toBe(1)
    expect(capturedSystem).not.toContain("APPLICANT ARTIST CONTEXT")
  })
})
