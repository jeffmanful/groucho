import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  DEFAULT_APPLICATION_OPENING_MESSAGE,
  DEFAULT_ONBOARDING_EXPERIENCE,
} from "@/lib/project-settings"

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
          ...payload,
          id,
          status: "active",
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

const customOpening = "Welcome to the door."

describe("startGatekeeperSession", () => {
  beforeEach(async () => {
    const supa = await import("@/lib/supabase")
    const s = (
      supa as unknown as { __state: { sessions: FakeRow[]; messages: FakeRow[] } }
    ).__state
    s.sessions = []
    s.messages = []
  })

  const projectSettings = {
    projectType: "gatekeeper" as const,
    applicationExperience: { opening_message: customOpening },
    flowConfig: null,
    onboardingExperience: { ...DEFAULT_ONBOARDING_EXPERIENCE },
    raw: {},
  }

  it("creates session with configured application opener", async () => {
    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_start_sess_12345678",
      applicantIdentity: { email: "applicant@example.com" },
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: projectSettings,
      },
      projectSettings,
    })
    expect(res.status).toBe(200)
    const body = await jsonFromResponse(res as Response)
    expect(body.bootstrapped).toBe(true)
    expect(body.projectType).toBe("gatekeeper")
    expect(body.message).toBe(customOpening)
    expect((body.ui as { inputType: string }).inputType).toBe("text")

    const supa = await import("@/lib/supabase")
    const s = (
      supa as unknown as {
        __state: { sessions: FakeRow[]; messages: FakeRow[] }
      }
    ).__state
    expect(s.sessions[0]?.applicant_email).toBe("applicant@example.com")
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]?.role).toBe("assistant")
    expect(s.messages[0]?.content).toBe(customOpening)
  })

  it("tags the opener with the first configured application signal", async () => {
    const settingsWithSignals = {
      ...projectSettings,
      applicationExperience: {
        ...projectSettings.applicationExperience,
        required_signals: ["Why they came", "Community contribution"],
      },
    }
    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_signal_state_12345678",
      applicantIdentity: { email: "applicant@example.com" },
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: settingsWithSignals,
      },
      projectSettings: settingsWithSignals,
    })
    expect(res.status).toBe(200)

    const supa = await import("@/lib/supabase")
    const state = (supa as unknown as { __state: { messages: FakeRow[] } })
      .__state
    expect(
      (state.messages[0]?.metadata as Record<string, unknown>)
        .application_next_signal,
    ).toEqual({ key: "why_they_came", label: "Why they came" })
  })

  it("uses client openingMessage over project default for new sessions", async () => {
    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_client_opening_12345678",
      openingMessage: "You're applying to COLORS.",
      allowMissingApplicantIdentity: true,
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: projectSettings,
      },
      projectSettings,
    })
    const body = await jsonFromResponse(res as Response)
    expect(body.message).toBe("You're applying to COLORS.")

    const supa = await import("@/lib/supabase")
    const s = (supa as unknown as { __state: { messages: FakeRow[] } }).__state
    expect(s.messages[0]?.content).toBe("You're applying to COLORS.")
  })

  it("uses client openingInteraction for the bootstrap ui", async () => {
    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_opening_interaction_12345678",
      openingInteraction: {
        intent: "probe",
        inputType: "singleSelect",
        emotionalState: "neutral",
        visualState: "curious",
        options: ["Artist", "Curator"],
      },
      allowMissingApplicantIdentity: true,
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: projectSettings,
      },
      projectSettings,
    })
    const body = await jsonFromResponse(res as Response)
    expect(body.ui).toEqual({
      intent: "probe",
      inputType: "singleSelect",
      emotionalState: "neutral",
      visualState: "curious",
      options: ["Artist", "Curator"],
    })

    const supa = await import("@/lib/supabase")
    const s = (supa as unknown as { __state: { messages: FakeRow[] } }).__state
    expect((s.messages[0]?.metadata as { ui: unknown }).ui).toEqual(body.ui)
  })

  it("is idempotent for existing active session", async () => {
    const supa = await import("@/lib/supabase")
    const s = (
      supa as unknown as { __state: { sessions: FakeRow[]; messages: FakeRow[] } }
    ).__state
    s.sessions.push({
      id: "s1",
      session_id: "gk_start_sess_12345678",
      project_id: "proj1",
      status: "active",
    })
    s.messages.push({
      id: "m1",
      session_id: "s1",
      role: "assistant",
      content: "Existing opener",
    })

    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_start_sess_12345678",
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: projectSettings,
      },
      projectSettings,
    })
    const body = await jsonFromResponse(res as Response)
    expect(body.message).toBe("Existing opener")
    expect(s.messages).toHaveLength(1)
  })

  it("rejects concluded session", async () => {
    const supa = await import("@/lib/supabase")
    const s = (
      supa as unknown as { __state: { sessions: FakeRow[] } }
    ).__state
    s.sessions.push({
      id: "s1",
      session_id: "gk_concluded_sess_12345678",
      project_id: "proj1",
      status: "passed",
    })

    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_concluded_sess_12345678",
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: projectSettings,
      },
      projectSettings,
    })
    expect(res.status).toBe(409)
    const body = await jsonFromResponse(res as Response)
    expect(body.error).toBe("Session concluded")
  })

  it("uses project openingInteraction when client override is absent", async () => {
    const configuredProjectSettings = {
      projectType: "gatekeeper" as const,
      applicationExperience: {
        opening_message: customOpening,
        opening_interaction: {
          inputType: "singleSelect" as const,
          options: ["Artist", "Curator"],
        },
      },
      flowConfig: null,
      onboardingExperience: { ...DEFAULT_ONBOARDING_EXPERIENCE },
      raw: {},
    }

    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_project_opening_interaction_12345678",
      allowMissingApplicantIdentity: true,
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: null,
        settings: configuredProjectSettings,
      },
      projectSettings: configuredProjectSettings,
    })
    const body = await jsonFromResponse(res as Response)
    expect(body.ui).toEqual({
      intent: "probe",
      inputType: "singleSelect",
      emotionalState: "neutral",
      visualState: "curious",
      options: ["Artist", "Curator"],
    })
  })

  it("requires applicant email for public API starts", async () => {
    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const res = await startGatekeeperSession({
      sessionId: "gk_missing_applicant_12345678",
      context: {
        organisationId: "org1",
        projectId: "proj1",
        apiKeyId: "key1",
        settings: {
          ...projectSettings,
          applicationExperience: {
            opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
          },
        },
      },
      projectSettings: {
        ...projectSettings,
        applicationExperience: {
          opening_message: DEFAULT_APPLICATION_OPENING_MESSAGE,
        },
      },
    })
    expect(res.status).toBe(400)
    const body = await jsonFromResponse(res as Response)
    expect(body.error).toBe("applicant.email is required to start a session")
  })
})
