import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  DEFAULT_APPLICATION_OPENING_MESSAGE,
  defaultOnboardingSteps,
} from "@/lib/project-settings"

type FakeRow = Record<string, unknown>

function jsonFromResponse(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

const recordVerdictMock = vi.fn().mockResolvedValue({
  profile: {
    schema_version: 1,
    core: null,
    custom: { intent: "join" },
    extraction: { model: "m", status: "ok" },
  },
})

vi.mock("@/lib/verdict-webhook", () => ({
  recordVerdictAndEnqueueWebhooks: (...args: unknown[]) =>
    recordVerdictMock(...args),
}))

vi.mock("@/lib/project-resolution", () => ({
  touchApiKeyLastUsed: vi.fn(),
}))

vi.mock("@/lib/onboarding-turn-intelligence", () => ({
  runOnboardingTurnIntelligence: vi.fn().mockResolvedValue(null),
  shouldHeuristicFollowup: vi.fn().mockReturnValue(false),
  defaultFollowupPrompt: vi.fn((s: { followup_prompt?: string }) =>
    s.followup_prompt ?? "Follow up?",
  ),
  verbatimNextMessage: vi.fn((s: { question: string }) => s.question),
  fallbackBridgeReply: vi.fn((s: { question: string }) => s.question),
}))

vi.mock("@/lib/onboarding-completion", () => ({
  generateOnboardingCompletion: vi
    .fn()
    .mockResolvedValue("Thanks — you're all set."),
  DEFAULT_CLOSING: "Thanks — you're all set.",
}))

function makeSupabaseMock(state: {
  sessions: FakeRow[]
  messages: FakeRow[]
  personas: FakeRow[]
}) {
  const chain = {
    _table: "" as string,
    _filters: [] as { col: string; val: unknown; op: "eq" | "is" }[],
    _updatePayload: null as Record<string, unknown> | null,
    from(table: string) {
      this._table = table
      this._filters = []
      this._updatePayload = null
      return this
    },
    select(_cols?: string) {
      return this
    },
    eq(col: string, val: unknown) {
      this._filters.push({ col, val, op: "eq" })
      return this
    },
    order(_col: string, _opts?: unknown) {
      return this
    },
    maybeSingle: async function () {
      const table = this._table
      const rows = (state as Record<string, FakeRow[]>)[table] ?? []
      const filtered = rows.filter((row) =>
        this._filters.every((f) => (row as Record<string, unknown>)[f.col] === f.val),
      )
      return { data: filtered[0] ?? null, error: null }
    },
    insert: function (payload: Record<string, unknown>) {
      const table = this._table
      if (table === "sessions") {
        const id = `s_${state.sessions.length + 1}`
        state.sessions.push({
          id,
          session_id: payload.session_id,
          project_id: payload.project_id,
          organisation_id: payload.organisation_id,
          status: "active",
          current_step_id: payload.current_step_id ?? null,
          flow_version: payload.flow_version ?? null,
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
    update(payload: Record<string, unknown>) {
      this._updatePayload = payload
      return this
    },
    then(onFulfilled: (v: { error: null }) => unknown) {
      const table = this._table
      if (table === "sessions" && this._updatePayload) {
        const rows = state.sessions
        const filtered = rows.filter((row) =>
          this._filters.every(
            (f) => (row as Record<string, unknown>)[f.col] === f.val,
          ),
        )
        for (const row of filtered) {
          Object.assign(row, this._updatePayload)
        }
      }
      return Promise.resolve({ error: null }).then(onFulfilled)
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
        prompt: "You are a calm onboarding host.",
        profile_schema: null,
        profile_extractor_hint: null,
        is_active: true,
        is_default: true,
      },
    ],
  }
  return { supabase: makeSupabaseMock(state), __state: state }
})

const flowSteps = defaultOnboardingSteps()
const experienceOff = {
  bridge_enabled: false,
  followup_enabled: false,
  boundary_enabled: false,
  personalized_completion: false,
}

describe("postOnboardingMessage", () => {
  beforeEach(() => {
    recordVerdictMock.mockClear().mockResolvedValue({
      profile: {
        schema_version: 1,
        core: null,
        custom: { intent: "x", interests: "y", values: "z" },
        extraction: { model: "m", status: "ok" },
      },
    })
  })

  async function loadState() {
    const supa = await import("@/lib/supabase")
    const s = (
      supa as unknown as { __state: { sessions: FakeRow[]; messages: FakeRow[] } }
    ).__state
    s.sessions = []
    s.messages = []
    return s
  }

  it("asks configured questions in order then completes with profile", async () => {
    await loadState()
    const { postOnboardingMessage } = await import("@/lib/post-onboarding-message")

    const base = {
      authorization: "Bearer gk_test_x",
      sessionId: "onboard_sess_12345678",
      applicantIdentity: { email: "applicant@example.com" },
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: "key1",
        settings: {
          projectType: "onboarding" as const,
          applicationExperience: {
            opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
          },
          flowConfig: { version: "2026-05-21", steps: flowSteps },
          onboardingExperience: experienceOff,
          raw: {},
        },
      },
      projectSettings: {
        projectType: "onboarding" as const,
        applicationExperience: {
          opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
        },
        flowConfig: { version: "2026-05-21", steps: flowSteps },
        onboardingExperience: experienceOff,
        raw: { persona_id: "persona1" },
      },
    }

    const r1 = await postOnboardingMessage({
      ...base,
      message: "Hello",
    })
    expect(r1.status).toBe(200)
    const b1 = await jsonFromResponse(r1 as Response)
    expect(b1.status).toBe("active")
    expect(b1.message).toBe(flowSteps[0].question)
    expect(b1.projectType).toBe("onboarding")
    expect((b1.currentStep as { id: string }).id).toBe(flowSteps[0].id)

    const r2 = await postOnboardingMessage({
      ...base,
      message: "I want to learn and contribute.",
    })
    const b2 = await jsonFromResponse(r2 as Response)
    expect(b2.status).toBe("active")
    expect(b2.message).toBe(flowSteps[1].question)

    const r3 = await postOnboardingMessage({
      ...base,
      message: "Music and community events.",
    })
    const b3 = await jsonFromResponse(r3 as Response)
    expect(b3.status).toBe("active")
    expect(b3.message).toBe(flowSteps[2].question)

    const r4 = await postOnboardingMessage({
      ...base,
      message: "Inclusive and member-led.",
    })
    const b4 = await jsonFromResponse(r4 as Response)
    expect(b4.status).toBe("passed")
    expect(b4.profile).toBeTruthy()
    expect(recordVerdictMock).toHaveBeenCalledTimes(1)
  })

  it("returns 409 when session already concluded", async () => {
    const st = await loadState()
    st.sessions.push({
      id: "s1",
      session_id: "onboard_done_12345678",
      project_id: "proj1",
      status: "passed",
      current_step_id: null,
    })
    const { postOnboardingMessage } = await import("@/lib/post-onboarding-message")
    const res = await postOnboardingMessage({
      authorization: "Bearer gk_test_x",
      sessionId: "onboard_done_12345678",
      message: "Hi",
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: {
          projectType: "onboarding",
          applicationExperience: {
            opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
          },
          flowConfig: { version: "1", steps: flowSteps },
          onboardingExperience: experienceOff,
          raw: {},
        },
      },
      projectSettings: {
        projectType: "onboarding",
        applicationExperience: {
          opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
        },
        flowConfig: { version: "1", steps: flowSteps },
        onboardingExperience: experienceOff,
        raw: {},
      },
    })
    expect(res.status).toBe(409)
  })
})
