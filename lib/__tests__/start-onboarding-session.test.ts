import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  DEFAULT_APPLICATION_OPENING_MESSAGE,
  DEFAULT_ONBOARDING_EXPERIENCE,
  defaultOnboardingSteps,
} from "@/lib/project-settings"
import { COLORS_DEFAULT_WELCOME } from "@/lib/onboarding-persona-template"

type FakeRow = Record<string, unknown>

function jsonFromResponse(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

vi.mock("@/lib/project-resolution", () => ({
  touchApiKeyLastUsed: vi.fn(),
}))

function makeSupabaseMock(state: {
  sessions: FakeRow[]
  messages: FakeRow[]
  personas: FakeRow[]
}) {
  const chain = {
    _table: "" as string,
    _filters: [] as { col: string; val: unknown }[],
    _updatePayload: null as Record<string, unknown> | null,
    _limit: null as number | null,
    from(table: string) {
      this._table = table
      this._filters = []
      this._updatePayload = null
      this._limit = null
      return this
    },
    select(_cols?: string) {
      return this
    },
    eq(col: string, val: unknown) {
      this._filters.push({ col, val })
      return this
    },
    order(_col: string, _opts?: { ascending?: boolean }) {
      return this
    },
    limit(n: number) {
      this._limit = n
      return this
    },
    maybeSingle: async function () {
      const table = this._table
      let rows = (state as Record<string, FakeRow[]>)[table] ?? []
      rows = rows.filter((row) =>
        this._filters.every((f) => (row as Record<string, unknown>)[f.col] === f.val),
      )
      if (table === "messages" && this._limit) {
        rows = [...rows].reverse().slice(0, this._limit)
      }
      return { data: rows[0] ?? null, error: null }
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
          onboarding_state: payload.onboarding_state ?? null,
        })
        return {
          select: () => ({
            single: async () => ({ data: { id }, error: null }),
          }),
        }
      }
      if (table === "messages") {
        const id = `m_${state.messages.length + 1}`
        state.messages.push({ id, ...payload, sent_at: new Date().toISOString() })
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) }
      }
      return { select: () => ({ single: async () => ({ data: null, error: null }) }) }
    },
    update(payload: Record<string, unknown>) {
      this._updatePayload = payload
      return this
    },
    then(onFulfilled: (v: { error: null }) => unknown) {
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
        is_active: true,
        is_default: true,
      },
    ],
  }
  return { supabase: makeSupabaseMock(state), __state: state }
})

const steps = defaultOnboardingSteps()

describe("startOnboardingSession", () => {
  beforeEach(async () => {
    const supa = await import("@/lib/supabase")
    const s = (
      supa as unknown as { __state: { sessions: FakeRow[]; messages: FakeRow[] } }
    ).__state
    s.sessions = []
    s.messages = []
  })

  it("creates session with first question and currentStep", async () => {
    const { startOnboardingSession } = await import("@/lib/start-onboarding-session")
    const res = await startOnboardingSession({
      sessionId: "start_sess_12345678",
      applicantIdentity: { email: "applicant@example.com" },
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: {
          projectType: "onboarding",
          applicationExperience: {
            opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
          },
          flowConfig: {
            version: "2026-05-21",
            welcome_message: COLORS_DEFAULT_WELCOME,
            steps,
          },
          onboardingExperience: { ...DEFAULT_ONBOARDING_EXPERIENCE },
          raw: {},
        },
      },
      projectSettings: {
        projectType: "onboarding",
        applicationExperience: {
          opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
        },
        flowConfig: {
          version: "2026-05-21",
          welcome_message: COLORS_DEFAULT_WELCOME,
          steps,
        },
        onboardingExperience: {
          bridge_enabled: true,
          followup_enabled: true,
          boundary_enabled: true,
          personalized_completion: true,
        },
        raw: {},
      },
    })
    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as Response)
    expect(body.bootstrapped).toBe(true)
    expect(body.welcomeMessage).toBe(COLORS_DEFAULT_WELCOME)
    expect(String(body.message)).toContain(steps[0].question)
    expect((body.currentStep as { id: string }).id).toBe(steps[0].id)
  })

  it("is idempotent for existing active session", async () => {
    const supa = await import("@/lib/supabase")
    const s = (
      supa as unknown as { __state: { sessions: FakeRow[]; messages: FakeRow[] } }
    ).__state
    s.sessions.push({
      id: "s1",
      session_id: "start_sess_12345678",
      project_id: "proj1",
      status: "active",
      current_step_id: steps[0].id,
      flow_version: "2026-05-21",
    })
    s.messages.push({
      id: "m1",
      session_id: "s1",
      role: "assistant",
      content: "Existing opener",
    })

    const { startOnboardingSession } = await import("@/lib/start-onboarding-session")
    const res = await startOnboardingSession({
      sessionId: "start_sess_12345678",
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: {
          projectType: "onboarding",
          applicationExperience: {
            opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
          },
          flowConfig: {
            version: "2026-05-21",
            welcome_message: COLORS_DEFAULT_WELCOME,
            steps,
          },
          onboardingExperience: { ...DEFAULT_ONBOARDING_EXPERIENCE },
          raw: {},
        },
      },
      projectSettings: {
        projectType: "onboarding",
        applicationExperience: {
          opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
        },
        flowConfig: { version: "2026-05-21", steps },
        onboardingExperience: {
          bridge_enabled: true,
          followup_enabled: true,
          boundary_enabled: true,
          personalized_completion: true,
        },
        raw: {},
      },
    })
    const body = await jsonFromResponse(res as Response)
    expect(body.message).toBe("Existing opener")
    expect(s.messages).toHaveLength(1)
  })
})
