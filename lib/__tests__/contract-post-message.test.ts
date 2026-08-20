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
  updates: Array<{
    table: string
    filters: Array<{ col: string; val: unknown; op: "eq" | "is" }>
    payload: Record<string, unknown>
  }>
}) {
  const chain = {
    _table: "" as string,
    _filters: [] as { col: string; val: unknown; op: "eq" | "is" }[],
    _pendingUpdate: null as Record<string, unknown> | null,
    from(table: string) {
      this._table = table
      this._filters = []
      this._pendingUpdate = null
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
      if (this._pendingUpdate) {
        state.updates.push({
          table,
          filters: [...this._filters],
          payload: this._pendingUpdate,
        })
        this._pendingUpdate = null
      }
      return Promise.resolve({ data: filtered, error: null }).then(onFulfilled)
    },
    insert: function (payload: any) {
      const table = this._table
      if (table === "sessions") {
        const id = `s_${state.sessions.length + 1}`
        state.sessions.push({
          ...payload,
          id,
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
    update: function (payload: Record<string, unknown>) {
      this._pendingUpdate = payload
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
    updates: [] as Array<{
      table: string
      filters: Array<{ col: string; val: unknown; op: "eq" | "is" }>
      payload: Record<string, unknown>
    }>,
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
    state.updates = []
    state.personas = [
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
    ]
  })

  it("continues an active session with its stored persona", async () => {
    const { resolveProjectContext } = await import("@/lib/project-resolution")
    vi.mocked(resolveProjectContext).mockResolvedValueOnce({
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
          raw: {
            project_type: "gatekeeper",
            persona_id: "project-persona",
          },
        },
      },
    })
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_persona",
      session_id: "sess_stored_persona_1",
      project_id: "proj1",
      persona_id: "session-persona",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.personas.push(
      {
        id: "session-persona",
        prompt: "SESSION PERSONA PROMPT",
        pass_threshold: 0.7,
        reject_threshold: 0.2,
        is_active: true,
        is_default: false,
      },
      {
        id: "project-persona",
        prompt: "PROJECT PERSONA PROMPT",
        pass_threshold: 0.7,
        reject_threshold: 0.2,
        is_active: true,
        is_default: false,
      },
    )

    let capturedSystem = ""
    anthropicCreateImpl = async (args: unknown) => {
      capturedSystem = (args as { system?: string }).system ?? ""
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_persona",
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
      sessionId: "sess_stored_persona_1",
      message: "hello",
      applicantIdentity: testApplicant,
    })

    expect(res.status).toBe(200)
    expect(capturedSystem).toContain("SESSION PERSONA PROMPT")
    expect(capturedSystem).not.toContain("PROJECT PERSONA PROMPT")
  })

  it("starts public message sessions with the project persona", async () => {
    const { resolveProjectContext } = await import("@/lib/project-resolution")
    vi.mocked(resolveProjectContext).mockResolvedValueOnce({
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
          raw: {
            project_type: "gatekeeper",
            persona_id: "project-persona",
          },
        },
      },
    })
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.personas.push({
      id: "project-persona",
      prompt: "PROJECT PERSONA PROMPT",
      pass_threshold: 0.7,
      reject_threshold: 0.2,
      is_active: true,
      is_default: false,
    })

    let capturedSystem = ""
    anthropicCreateImpl = async (args: unknown) => {
      capturedSystem = (args as { system?: string }).system ?? ""
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_project_persona",
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
      sessionId: "sess_project_persona_1",
      message: "hello",
      applicantIdentity: testApplicant,
    })

    expect(res.status).toBe(200)
    expect(capturedSystem).toContain("PROJECT PERSONA PROMPT")
    expect(state.sessions[0]?.persona_id).toBe("project-persona")
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
    expect(body.message).toBe("It was good getting to understand you better.")
    expect(recordVerdictMock).toHaveBeenCalled()
    const [opts] = recordVerdictMock.mock.calls[0] as [Record<string, unknown>]
    expect(opts.persona).toBeTruthy()
    expect(Array.isArray(opts.transcript)).toBe(true)
  })

  it("surfaces terminal reviewer report and forwards it to verdict payload creation", async () => {
    const reviewerReport = {
      applicant_bio:
        "Runs a monthly listening session and writes context notes for artists.",
      advisory_recommendation: "recommend",
      confidence_score: 0.86,
      evidence_summary: [
        "Specific recurring maker/multiplier participation",
        "Clear role selecting artists and writing context",
      ],
      weak_or_missing_signals: ["Reviewer may want to confirm first-month capacity."],
      safety_or_integrity_flags: [],
      reviewer_focus: "Check whether their proposed weekly artist thread fits the Forum.",
    }

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_report",
          name: "groucho_respond",
          input: {
            reply: "Thanks. We'll be in touch.",
            terminal: "pass",
            intent: "decide",
            inputType: "text",
            emotionalState: "decisive",
            visualState: "decision",
            scores: {
              specificity: 0.9,
              authenticity: 0.82,
              cultural_depth: 0.84,
              overall: 0.87,
            },
            reviewerReport,
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_reviewer_report_1",
      message: "hello",
      applicantIdentity: testApplicant,
    })

    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as any)
    expect(body.reviewerReport).toEqual(reviewerReport)
    const [opts] = recordVerdictMock.mock.calls[0] as [Record<string, unknown>]
    expect(opts.reviewerReport).toEqual(reviewerReport)
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
    expect(body.message).toBe("It was good getting to understand you better.")
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
      max_tokens: 1100,
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
              coveredSignalKeys: ["intent"],
              bridgeCandidates: [
                {
                  sourceDetail: "Wants to contribute something useful",
                  kind: "aspiration_to_contribution",
                  targetSignalKey: "contribution",
                  connectionIntent:
                    "Their wish to be useful can become a concrete Forum action",
                  questionIntent:
                    "Understand what useful participation would look like in practice",
                  confidence: 0.84,
                  freshness: "current",
                },
              ],
              selectedBridgeIndex: 0,
              responseMode: "connect",
              threadState: {
                subject: "Participation",
                strongestDetail: "Wants to contribute something useful",
                openHook: "What useful participation means in practice",
                momentum: "medium",
                applicantEnergy: "engaged",
                acknowledgedDetails: ["Something useful"],
              },
              nextSignalKey: "intent",
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
    expect(capturedSystem).toContain("Soft conversational target: around 4 applicant answers")
    expect(capturedSystem).toContain("receive → connect → invite")
    expect(capturedSystem).toContain("connectionIntent")
    expect(capturedSystem).toContain("one or two short sentences")
    expect(capturedSystem).toContain("reuse the applicant's concrete action")
    expect(capturedSystem).toContain("What would you actually do with that in the Forum?")
    expect(capturedSystem).toContain("that kind of listening")
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]?.role).toBe("user")
    expect(capturedMessages[0]?.content).toContain("compact application state")
    expect(capturedMessages[0]?.content).toContain('"intent"')
    expect(capturedMessages[0]?.content).toContain('"status": "open"')
    expect(capturedMessages[0]?.content).toContain(
      "private evidence intents, not a checklist",
    )
    expect(capturedMessages[0]?.content).toContain('"conversationThread"')
    expect(capturedMessages[0]?.content).toContain(
      '"priorityConversationBridges"',
    )
    expect(capturedMessages[0]?.content).toContain('"artistToSong"')
    expect(capturedMessages[0]?.content).toContain(
      "one of their songs that you have—or would—share",
    )
    expect(capturedMessages[0]?.content).toContain("which song from that album")
    expect(capturedMessages[0]?.content).toContain("natural response about their music")
    expect(capturedMessages[0]?.content).toContain('"bridgeHistory"')
    const supa = await import("@/lib/supabase")
    const state = (supa as unknown as {
      __state: {
        messages: FakeRow[]
        updates: Array<{
          table: string
          filters: Array<{ col: string; val: unknown }>
          payload: { metadata: { application_signals: unknown } }
        }>
      }
    }).__state
    const userRow = state.messages.find((row: FakeRow) => row.content === "hello")
    expect(userRow).toBeDefined()
    const metadataUpdate = state.updates.find(
      (update: { table: string; filters: Array<{ col: string; val: unknown }> }) =>
        update.table === "messages" &&
        update.filters.some((filter) => filter.col === "id" && filter.val === userRow?.id),
    )
    expect(metadataUpdate).toBeDefined()
    expect(metadataUpdate?.payload.metadata.application_signals).toEqual([
      { key: "intent", label: "intent" },
    ])
    const assistantRow = state.messages.at(-1)
    const assistantMetadata = assistantRow?.metadata as
      | { conversation_thread?: unknown }
      | undefined
    expect(assistantMetadata?.conversation_thread).toMatchObject({
      subject: "Participation",
      momentum: "medium",
    })
    expect(
      (assistantRow?.metadata as { response_mode?: unknown } | undefined)
        ?.response_mode,
    ).toBe("connect")
    expect(
      (
        assistantRow?.metadata as
          | { conversation_bridge?: Record<string, unknown> }
          | undefined
      )?.conversation_bridge,
    ).toMatchObject({
      kind: "aspiration_to_contribution",
      targetSignalKey: "contribution",
    })
    expect(
      (
        assistantRow?.metadata as
          | { application_next_signal?: Record<string, unknown> }
          | undefined
      )?.application_next_signal,
    ).toMatchObject({ key: "contribution", label: "contribution" })
    expect(
      (
        assistantRow?.metadata as
          | { application_question_signal_mismatch?: boolean }
          | undefined
      )?.application_question_signal_mismatch,
    ).toBeUndefined()
  })

  it("persists answer quality and an accepted open-door move", async () => {
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
            required_signals: ["What brought you here?", "Contribution"],
            max_turns: 9,
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

    const thinAssessment = {
      quality: "thin",
      reason: "No usable point of view yet.",
      evidence: {
        personalPointOfView: false,
        concreteDetail: false,
        emotionalConnection: false,
        independentJudgment: false,
        careOrContext: false,
      },
    }
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_depth",
      session_id: "sess_depth_1",
      project_id: "proj1",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.messages.push(
      {
        id: "m_depth_open",
        session_id: "s_depth",
        role: "assistant",
        content: "What brought you here?",
        metadata: {
          application_next_signal: {
            key: "what_brought_you_here",
            label: "What brought you here?",
          },
        },
      },
      {
        id: "m_depth_user",
        session_id: "s_depth",
        role: "user",
        content: "Community.",
        metadata: {
          application_signal: {
            key: "what_brought_you_here",
            label: "What brought you here?",
          },
          answer_assessment: thinAssessment,
        },
      },
      {
        id: "m_depth_question",
        session_id: "s_depth",
        role: "assistant",
        content: "What would you contribute?",
        metadata: {
          conversation_move: "advance",
          application_next_signal: {
            key: "contribution",
            label: "Contribution",
          },
        },
      },
    )

    let compactPrompt = ""
    anthropicCreateImpl = async (args: unknown) => {
      compactPrompt = (
        args as { messages: Array<{ content: string }> }
      ).messages[0]?.content ?? ""
      return {
        content: [
          {
            type: "tool_use",
            id: "toolu_depth",
            name: "groucho_respond",
            input: {
              reply:
                "Let's try another angle. What creative subject do people tend to miss?",
              terminal: "none",
              intent: "clarify",
              inputType: "text",
              emotionalState: "curious",
              visualState: "curious",
              scores: {
                specificity: 0.4,
                authenticity: 0.5,
                cultural_depth: 0.4,
                overall: 0.43,
              },
              answerAssessment: thinAssessment,
              conversationMove: "open_door",
              nextSignalKey: "contribution",
            },
          },
        ],
      }
    }

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_depth_1",
      message: "Something useful.",
      applicantIdentity: testApplicant,
    })

    expect(res.status).toBe(200)
    expect(compactPrompt).toContain('"recentQualities": [\n      "thin"')
    const persistedUser = state.messages.find(
      (row: FakeRow) => row.content === "Something useful.",
    )
    const userMetadataUpdate = state.updates.find(
      (update: { table: string; filters: Array<{ col: string; val: unknown }> }) =>
        update.table === "messages" &&
        update.filters.some(
          (filter) => filter.col === "id" && filter.val === persistedUser.id,
        ),
    )
    const persistedAssistant = state.messages.at(-1)
    const updatedMetadata = userMetadataUpdate.payload.metadata as Record<
      string,
      unknown
    >
    const persistedAssessment = updatedMetadata.answer_assessment as Record<
      string,
      unknown
    >
    const assistantMetadata = persistedAssistant.metadata as Record<
      string,
      unknown
    >
    expect(persistedAssessment.quality).toBe("thin")
    expect(assistantMetadata.conversation_move).toBe("open_door")
    expect(assistantMetadata.conversation_move_adjusted).toBe(undefined)
  })

  it("prefers a fresh maker bridge over a supporting artist recommendation", async () => {
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
            opening_message: "Who is an artist more people should know about?",
            required_signals: [
              "Name an artist more people should know about.",
              "Last song recommended",
              "Contribution",
            ],
            max_turns: 9,
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

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_maker_priority",
          name: "groucho_respond",
          input: {
            reply:
              "That connection matters. Let me shift slightly. What's one track of theirs you'd share?",
            terminal: "none",
            intent: "probe",
            inputType: "text",
            emotionalState: "curious",
            visualState: "curious",
            conversationMove: "advance",
            responseMode: "connect",
            coveredSignalKeys: [
              "name_an_artist_more_people_should_know_about",
            ],
            bridgeCandidates: [
              {
                sourceDetail: "They connect Tirzah to their own work",
                kind: "person_to_work",
                targetSignalKey: "last_song_recommended",
                connectionIntent:
                  "Their connection to Tirzah can become a specific recommendation",
                questionIntent: "Ask which Tirzah song they would share",
                confidence: 0.9,
                freshness: "current",
              },
              {
                sourceDetail: "They make music influenced by Tirzah",
                kind: "maker_to_practice",
                targetSignalKey: "contribution",
                connectionIntent:
                  "Their response to Tirzah is reflected in their own music-making",
                questionIntent:
                  "Understand what they are trying to express in their own music",
                confidence: 0.88,
                freshness: "current",
              },
            ],
            selectedBridgeIndex: 0,
            threadState: {
              subject: "Tirzah and the applicant's own music",
              strongestDetail: "The artist mirrors something in their work",
              openHook: "What they are expressing in their music",
              momentum: "high",
              applicantEnergy: "engaged",
              acknowledgedDetails: [],
            },
            nextSignalKey: "last_song_recommended",
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_maker_priority_1",
      message: "Tirzah. Her music mirrors something in the music I make.",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res)
    expect(body.status).toBe("active")
    expect(body.message).toBe(
      "What are you trying to express in your own music?",
    )

    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    const assistantMetadata = state.messages.at(-1).metadata as Record<
      string,
      unknown
    >
    expect(assistantMetadata.conversation_bridge_adjusted).toBe(true)
    expect(assistantMetadata.conversation_bridge).toMatchObject({
      kind: "maker_to_practice",
      targetSignalKey: "contribution",
    })
    expect(assistantMetadata.application_next_signal).toMatchObject({
      key: "contribution",
    })
    expect(assistantMetadata.application_question_signal_mismatch).toBeUndefined()
  })

  it("does not let advance repeat the same unresolved question", async () => {
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
            opening_message: "How do you approach feedback?",
            required_signals: [
              "How do you approach unfinished music?",
              "What's one thing you could realistically contribute in your first month?",
            ],
            max_turns: 9,
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

    const thinAssessment = {
      quality: "thin",
      reason: "No usable detail yet.",
      evidence: {
        personalPointOfView: false,
        concreteDetail: false,
        emotionalConnection: false,
        independentJudgment: false,
        careOrContext: false,
      },
    }
    const feedbackSignal = {
      key: "how_do_you_approach_unfinished_music",
      label: "How do you approach unfinished music?",
    }
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_repeat",
      session_id: "sess_repeat_1",
      project_id: "proj1",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.messages.push(
      {
        id: "m_repeat_open",
        session_id: "s_repeat",
        role: "assistant",
        content: "How do you approach feedback?",
        metadata: {
          application_next_signal: feedbackSignal,
          conversation_bridge: {
            kind: "feedback_to_care",
          },
        },
      },
      {
        id: "m_repeat_user",
        session_id: "s_repeat",
        role: "user",
        content: "I try to be fair.",
        metadata: {
          application_signal: feedbackSignal,
          application_signals: [],
          answer_assessment: thinAssessment,
        },
      },
      {
        id: "m_repeat_question",
        session_id: "s_repeat",
        role: "assistant",
        content: "How do you approach feedback when it is not naturally for you?",
        metadata: {
          conversation_move: "clarify",
          application_next_signal: feedbackSignal,
          conversation_bridge: {
            kind: "feedback_to_care",
          },
        },
      },
      {
        id: "m_repeat_user_2",
        session_id: "s_repeat",
        role: "user",
        content: "I would try not to be harsh.",
        metadata: {
          application_signal: feedbackSignal,
          application_signals: [],
          answer_assessment: thinAssessment,
        },
      },
      {
        id: "m_repeat_question_2",
        session_id: "s_repeat",
        role: "assistant",
        content: "What would useful honesty sound like in that situation?",
        metadata: {
          conversation_move: "clarify",
          application_next_signal: feedbackSignal,
        },
      },
    )

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_repeat",
          name: "groucho_respond",
          input: {
            reply: "How do you approach feedback when it is not naturally for you?",
            terminal: "none",
            conversationMove: "advance",
            nextSignalKey: feedbackSignal.key,
            answerAssessment: thinAssessment,
            bridgeCandidates: [
              {
                sourceDetail: "Separating taste from whether the work functions",
                kind: "feedback_to_care",
                targetSignalKey: feedbackSignal.key,
                connectionIntent:
                  "Their distinction between taste and function can reveal how they give useful feedback",
                questionIntent: "Ask again how they make feedback useful",
                confidence: 0.86,
                freshness: "current",
              },
            ],
            selectedBridgeIndex: 0,
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_repeat_1",
      message: "I try to separate taste from whether it works.",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res)
    expect(body.status).toBe("active")
    expect(body.message).toContain("giving back in music communities")
    const assistantMetadata = state.messages.at(-1).metadata as Record<
      string,
      unknown
    >
    expect(assistantMetadata.conversation_move).toBe("advance")
    expect(assistantMetadata.conversation_move_adjusted).toBe(true)
    expect(assistantMetadata.conversation_bridge_adjusted).toBe(true)
    expect(assistantMetadata.conversation_bridge).toBeUndefined()
    expect(assistantMetadata.application_next_signal).toMatchObject({
      key: "what_s_one_thing_you_could_realistically_contrib",
    })
    const exhaustedUser = state.messages.find(
      (row: FakeRow) =>
        row.role === "user" &&
        row.content === "I try to separate taste from whether it works.",
    )
    const exhaustedUpdate = state.updates.find(
      (update: { table: string; filters: Array<{ col: string; val: unknown }> }) =>
        update.table === "messages" &&
        update.filters.some(
          (filter) => filter.col === "id" && filter.val === exhaustedUser?.id,
        ),
    )
    expect(exhaustedUpdate?.payload.metadata).toMatchObject({
      application_insufficient_evidence: {
        key: feedbackSignal.key,
        attempts: 3,
      },
    })
  })

  it("uses a higher emergency loop stop instead of closing at the soft target", async () => {
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
            closing_message: "Thanks. We have what we need for review.",
            required_signals: ["What brought you here?"],
            max_turns: 9,
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

    const signal = {
      key: "what_brought_you_here",
      label: "What brought you here?",
    }
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_hard_stop",
      session_id: "sess_hard_stop_1",
      project_id: "proj1",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.messages.push({
      id: "m_hard_open",
      session_id: "s_hard_stop",
      role: "assistant",
      content: "What brought you here?",
      metadata: { application_next_signal: signal },
    })
    for (let index = 1; index <= 11; index += 1) {
      state.messages.push(
        {
          id: `m_hard_user_${index}`,
          session_id: "s_hard_stop",
          role: "user",
          content: `Answer ${index}`,
          metadata: {
            application_signal: signal,
            application_signals: [],
          },
        },
        {
          id: `m_hard_assistant_${index}`,
          session_id: "s_hard_stop",
          role: "assistant",
          content: `Question ${index + 1}?`,
          metadata: {
            conversation_move: "advance",
            application_next_signal: signal,
          },
        },
      )
    }

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_hard_stop",
          name: "groucho_respond",
          input: {
            reply: "One more question?",
            terminal: "none",
            conversationMove: "advance",
            nextSignalKey: signal.key,
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_hard_stop_1",
      message: "Answer 12",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res)
    expect(body.status).toBe("redirected")
    expect(body.message).toBe("Thanks. We have what we need for review.")
    const assistantMetadata = state.messages.at(-1).metadata as Record<
      string,
      unknown
    >
    expect(assistantMetadata.gatekeeper_terminal).toBe("redirect")
    expect(assistantMetadata.application_budget_forced_close).toBe(true)
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

  it("uses persisted intent metadata rather than replacing natural wording with a regex template", async () => {
    const { resolveProjectContext } = await import("@/lib/project-resolution")
    const contributionProject: Awaited<
      ReturnType<typeof resolveProjectContext>
    > = {
      ok: true,
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: "key1",
        settings: {
          projectType: "gatekeeper" as const,
          applicationExperience: {
            opening_message: "What brought you here?",
            required_signals: [
              "What brought you here?",
              "What's one thing you could realistically contribute in your first month?",
            ],
            max_turns: 9,
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
    }
    vi.mocked(resolveProjectContext).mockResolvedValueOnce(contributionProject)

    const contributionSignal = {
      key: "what_s_one_thing_you_could_realistically_contrib",
      label:
        "What's one thing you could realistically contribute in your first month?",
    }
    const motivationSignal = {
      key: "what_brought_you_here",
      label: "What brought you here?",
    }
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_integrity_contribution",
      session_id: "sess_integrity_contribution",
      project_id: "proj1",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.messages.push({
      id: "m_integrity_wrong_question",
      session_id: "s_integrity_contribution",
      role: "assistant",
      content:
        "What would a music community need to feel like for you to take part rather than only observe?",
      metadata: { application_next_signal: contributionSignal },
    })

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_integrity_contribution",
          name: "groucho_respond",
          input: {
            reply:
              "What would you actually contribute if that kind of space existed?",
            terminal: "redirect",
            intent: "redirect",
            inputType: "text",
            emotionalState: "decisive",
            visualState: "decision",
            scores: {
              specificity: 0.78,
              authenticity: 0.85,
              cultural_depth: 0.72,
              overall: 0.78,
            },
            answerAssessment: {
              quality: "rich",
              reason: "A clear community preference, but no concrete action.",
              evidence: {
                personalPointOfView: true,
                concreteDetail: true,
                emotionalConnection: true,
                independentJudgment: true,
                careOrContext: true,
              },
            },
            conversationMove: "decide",
            coveredSignalKeys: [
              motivationSignal.key,
              contributionSignal.key,
            ],
            nextSignalKey: "",
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_integrity_contribution",
      message:
        "I'd take part if a comment could be as simple as connecting a song to a feeling.",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res)

    expect(body.status).toBe("redirected")
    expect(body.message).toBe("It was good getting to understand you better.")
    const persistedUser = state.messages.find(
      (row: FakeRow) => row.content ===
        "I'd take part if a comment could be as simple as connecting a song to a feeling.",
    )
    const userUpdate = state.updates.find(
      (update: { table: string; filters: Array<{ col: string; val: unknown }> }) =>
        update.table === "messages" &&
        update.filters.some(
          (filter) => filter.col === "id" && filter.val === persistedUser?.id,
        ),
    )
    expect(userUpdate?.payload.metadata).toMatchObject({
      application_signal: contributionSignal,
      application_signals: [motivationSignal],
    })
    const assistantMetadata = state.messages.at(-1).metadata as Record<
      string,
      unknown
    >
    expect(assistantMetadata.application_budget_forced_close).toBeUndefined()
    expect(body.reviewStatus).toBe("pending")
    expect(body.secret).toBeUndefined()
    expect(
      state.updates.some(
        (update: { table: string; payload: Record<string, unknown> }) =>
          update.table === "sessions" &&
          Object.prototype.hasOwnProperty.call(update.payload, "success_secret"),
      ),
    ).toBe(false)
    const completedMetadata = state.messages.at(-1).metadata as Record<
      string,
      unknown
    >
    expect(completedMetadata.gatekeeper_terminal).toBe("redirect")
    expect(
      (completedMetadata.reviewer_report as { evidence_summary: string[] })
        .evidence_summary.length,
    ).toBeGreaterThan(0)
  })

  it("adds a question when a single-select response only contains acknowledgement", async () => {
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
            required_signals: [
              "What brought you here?",
              "Which sounds most like you?",
            ],
            max_turns: 9,
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

    const intentSignal = {
      key: "what_brought_you_here",
      label: "What brought you here?",
    }
    const participationSignal = {
      key: "which_sounds_most_like_you",
      label: "Which sounds most like you?",
    }
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_integrity_select",
      session_id: "sess_integrity_select",
      project_id: "proj1",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.messages.push({
      id: "m_integrity_select_question",
      session_id: "s_integrity_select",
      role: "assistant",
      content: "What brought you here?",
      metadata: { application_next_signal: intentSignal },
    })

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_integrity_select",
          name: "groucho_respond",
          input: {
            reply:
              "You're thinking about what might resonate with them, not only what you like.",
            terminal: "none",
            intent: "probe",
            inputType: "singleSelect",
            options: [
              "I mostly listen",
              "I like discussing music",
              "I enjoy giving feedback",
              "I regularly share discoveries",
            ],
            emotionalState: "interested",
            visualState: "interested",
            scores: {
              specificity: 0.75,
              authenticity: 0.78,
              cultural_depth: 0.72,
              overall: 0.75,
            },
            answerAssessment: {
              quality: "usable",
              reason: "Clear motivation.",
              evidence: {
                personalPointOfView: true,
                concreteDetail: false,
                emotionalConnection: true,
                independentJudgment: true,
                careOrContext: true,
              },
            },
            conversationMove: "advance",
            coveredSignalKeys: [intentSignal.key],
            nextSignalKey: participationSignal.key,
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_integrity_select",
      message: "I want to find people who listen closely.",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res)

    expect(body.status).toBe("active")
    expect(body.message).toContain(
      "Which of these sounds most like how you participate around music?",
    )
    expect(body.ui).toMatchObject({
      inputType: "singleSelect",
      options: [
        "I mostly listen",
        "I like discussing music",
        "I enjoy giving feedback",
        "I regularly share discoveries",
      ],
    })
    expect(state.messages.at(-1).metadata).toMatchObject({
      application_next_signal: participationSignal,
    })
  })

  it("stays with an explicit community intent before asking about artists", async () => {
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
            required_signals: [
              "What brought you here?",
              "Name an artist more people should know about.",
              "What's the last song you recommended, and why?",
              "Someone shares unfinished music that isn't really for you. How would you respond?",
              "Which sounds most like you?",
              "What's one thing you could realistically contribute in your first month?",
            ],
            max_turns: 9,
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

    const openingSignal = {
      key: "what_brought_you_here",
      label: "What brought you here?",
    }
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_community_intent",
      session_id: "sess_community_intent",
      project_id: "proj1",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.messages.push({
      id: "m_community_opening",
      session_id: "s_community_intent",
      role: "assistant",
      content: "What brought you here?",
      metadata: { application_next_signal: openingSignal },
    })

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_community_intent",
          name: "groucho_respond",
          input: {
            reply: "Good—community is a real reason to be here. Tell me about an artist more people should know about.",
            terminal: "none",
            intent: "probe",
            inputType: "text",
            emotionalState: "curious",
            visualState: "curious",
            scores: {
              specificity: 0.4,
              authenticity: 0.65,
              cultural_depth: 0.4,
              overall: 0.48,
            },
            answerAssessment: {
              quality: "thin",
              reason: "Intent is clear but unexplained.",
              evidence: {
                personalPointOfView: false,
                concreteDetail: false,
                emotionalConnection: false,
                independentJudgment: false,
                careOrContext: true,
              },
            },
            conversationMove: "advance",
            coveredSignalKeys: [openingSignal.key],
            nextSignalKey: "name_an_artist_more_people_should_know_about",
            participantOrientation: {
              scores: { artist: 0, curator: 0, enthusiast: 0.4 },
              evidence: ["Selected community"],
            },
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_community_intent",
      message: "Community",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res)

    expect(body).toMatchObject({
      status: "active",
      message: "What does community mean to you?",
    })
    expect(state.messages.at(-1).metadata).toMatchObject({
      application_community_intent_followup: true,
      conversation_move: "clarify",
      participant_orientation: {
        primary: "enthusiast",
        confidence: 0.72,
      },
      application_next_signal: openingSignal,
    })
  })

  it("adds the next open question when an active text reply only reflects", async () => {
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
            required_signals: [
              "What brought you here?",
              "What's one thing you could realistically contribute in your first month?",
            ],
            max_turns: 9,
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

    const intentSignal = {
      key: "what_brought_you_here",
      label: "What brought you here?",
    }
    const contributionSignal = {
      key: "what_s_one_thing_you_could_realistically_contrib",
      label:
        "What's one thing you could realistically contribute in your first month?",
    }
    const supa = await import("@/lib/supabase")
    const state = (supa as any).__state
    state.sessions.push({
      id: "s_integrity_text_invitation",
      session_id: "sess_integrity_text_invitation",
      project_id: "proj1",
      applicant_email: testApplicant.email,
      status: "active",
    })
    state.messages.push({
      id: "m_integrity_text_question",
      session_id: "s_integrity_text_invitation",
      role: "assistant",
      content: "What brought you here?",
      metadata: { application_next_signal: intentSignal },
    })

    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "tool_use",
          id: "toolu_integrity_text_invitation",
          name: "groucho_respond",
          input: {
            reply:
              "You're looking for conversations about why music stays with people, not another stream of recommendations.",
            terminal: "none",
            intent: "acknowledge",
            inputType: "text",
            emotionalState: "interested",
            visualState: "interested",
            scores: {
              specificity: 0.76,
              authenticity: 0.82,
              cultural_depth: 0.74,
              overall: 0.78,
            },
            answerAssessment: {
              quality: "rich",
              reason: "Clear motivation and community intent.",
              evidence: {
                personalPointOfView: true,
                concreteDetail: true,
                emotionalConnection: true,
                independentJudgment: true,
                careOrContext: true,
              },
            },
            conversationMove: "rabbit_hole",
            coveredSignalKeys: [intentSignal.key],
            nextSignalKey: intentSignal.key,
          },
        },
      ],
    })

    const { postSessionMessage } = await import("@/lib/post-session-message")
    const res = await postSessionMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "sess_integrity_text_invitation",
      message:
        "I want people to talk with about why certain music stays with them.",
      applicantIdentity: testApplicant,
    })
    const body = await jsonFromResponse(res)

    expect(body.status).toBe("active")
    expect(body.message).toContain(
      "You're looking for conversations about why music stays with people",
    )
    expect(body.message).toContain("?")
    expect(state.messages.at(-1).metadata).toMatchObject({
      application_next_signal: contributionSignal,
      application_active_reply_repair: {
        issue: "missing_invitation",
        action: "next_signal",
        signalKey: contributionSignal.key,
      },
    })
  })
})
