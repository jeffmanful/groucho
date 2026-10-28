import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  session: { id: "session", session_id: "client-session", status: "completed", profile: null as unknown } as { id: string; session_id: string; status: string; profile: unknown } | null,
  metadata: {} as Record<string, unknown>,
  engine: "colors_thin_pilot_v1",
  claim: true,
  failSessionWrite: false,
  updates: [] as Array<{ table: string; value: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  assess: vi.fn(),
}))

vi.mock("@/lib/colors-thin-assessment", async original => ({
  ...await original<typeof import("@/lib/colors-thin-assessment")>(),
  generateColorsThinAssessment: (...args: unknown[]) => state.assess(...args),
}))
vi.mock("@/lib/supabase", () => ({ supabase: { from(table: string) {
  let update: Record<string, unknown> | null = null
  const filters: Array<[string, unknown]> = []
  const result = () => {
    if (update) {
      state.updates.push({ table, value: update, filters: [...filters] })
      if (table === "sessions" && state.failSessionWrite) return { data: null, error: { code: "write-failed" } }
      return { data: state.claim ? { id: "closing" } : null, error: null }
    }
    state.reads.push({ table, filters: [...filters] })
    return { data: table === "sessions" ? state.session : { settings: { decision_policy: { automatic_acceptance_enabled: true } } }, error: null }
  }
  const chain = {
    select() { return chain },
    update(value: Record<string, unknown>) { update = value; return chain },
    eq(key: string, value: unknown) { filters.push([key, value]); return chain },
    is(key: string, value: unknown) { filters.push([key, value]); return chain },
    maybeSingle: async () => result(),
    order: async () => ({ data: [
      { id: "opening", role: "assistant", content: "Why join?", metadata: { conversation_engine: state.engine, colors_demo_session: true } },
      { id: "answer", role: "user", content: "I share references with friends.", metadata: {} },
      { id: "closing", role: "assistant", content: "Thank you.", metadata: state.metadata },
    ], error: null }),
    then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve) },
  }
  return chain
} } }))

import { assessColorsApplication } from "@/lib/admin-colors-assessment"
import { COLORS_FORUM_MEMBERSHIP_REPORT_VERSION } from "@/lib/reviewer-report"
import { adminSessionAssessment } from "@/lib/admin-session-report"

const report = {
  applicant_bio: "Shares references with friends.", advisory_recommendation: "recommend", confidence_score: 0.78,
  evidence_summary: ["Shares references."], evidence_references: [{ signal_key: "community", signal_label: "Community", source_message_id: "answer", excerpt: "I share references with friends." }], weak_or_missing_signals: [],
  safety_or_integrity_flags: [], reviewer_focus: "Read the conversation.", report_version: COLORS_FORUM_MEMBERSHIP_REPORT_VERSION,
  detailed_opinion: { overall_assessment: "Shares music with friends.", decisive_reasons: [], claim_assessments: [{ claim: "Shares music.", interpretation: "A listening exchange.", assessment: "strength", evidence_reference_ids: ["answer"] }], likely_contribution: "References.", reservations: [], reviewer_questions: [], suggested_human_action: "approve" },
}
const input = { organisationId: "org", projectId: "project", sessionId: "session" }

beforeEach(() => {
  state.session = { id: "session", session_id: "client-session", status: "completed", profile: null }
  state.metadata = { colors_demo_report_status: "failed" }
  state.engine = "colors_thin_pilot_v1"
  state.claim = true
  state.failSessionWrite = false
  state.updates = []
  state.reads = []
  state.assess.mockReset().mockResolvedValue({ report, profile: { extraction: { status: "ok" } } })
})

describe("admin COLORS assessment recovery", () => {
  it("assesses an existing demo, saves its profile and score, and only touches assessment tables", async () => {
    expect(await assessColorsApplication(input)).toEqual({ status: "ready" })
    expect(state.assess).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: "client-session" }))
    expect(state.updates.find(row => row.table === "sessions")?.value).toMatchObject({ suitability_score: 0.834 })
    expect(state.updates.at(-1)?.value).toMatchObject({ metadata: { colors_demo_report_status: "ready", reviewer_report: report } })
    // Even with automatic acceptance configured, recovery cannot decide or enqueue events.
    expect(new Set(state.updates.map(row => row.table))).toEqual(new Set(["messages", "sessions"]))
    expect(state.reads).toEqual(expect.arrayContaining([
      { table: "sessions", filters: [["id", "session"], ["project_id", "project"], ["organisation_id", "org"]] },
      { table: "projects", filters: [["id", "project"], ["organisation_id", "org"]] },
    ]))
  })

  it("does not generate or write when the application is outside the requested scope", async () => {
    state.session = null
    expect(await assessColorsApplication(input)).toMatchObject({ httpStatus: 404 })
    expect(state.assess).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })

  it.each(["active", "abandoned"])("rejects a %s conversation", async status => {
    state.session!.status = status
    expect(await assessColorsApplication(input)).toMatchObject({ httpStatus: 409 })
    expect(state.assess).not.toHaveBeenCalled()
  })

  it("rejects legacy engine recovery instead of applying the wrong rubric", async () => {
    state.engine = "legacy"
    expect(await assessColorsApplication(input)).toMatchObject({ httpStatus: 409 })
    expect(state.assess).not.toHaveBeenCalled()
  })

  it("leaves a current generation alone", async () => {
    state.metadata = { colors_demo_report_status: "generating", colors_demo_report_started_at: Date.now() - 120_000 }
    expect(await assessColorsApplication(input)).toEqual({ status: "pending" })
    expect(state.assess).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })

  it("does not generate after losing a concurrent claim", async () => {
    state.claim = false
    expect(await assessColorsApplication(input)).toEqual({ status: "pending" })
    expect(state.assess).not.toHaveBeenCalled()
    expect(state.updates[0].filters).toContainEqual(["metadata", JSON.stringify(state.metadata)])
  })

  it("recovers a stale generation", async () => {
    state.metadata = { colors_demo_report_status: "generating", colors_demo_report_started_at: Date.now() - 301_000 }
    expect(await assessColorsApplication(input)).toEqual({ status: "ready" })
    expect(state.assess).toHaveBeenCalledOnce()
  })

  it("does not mark a report ready if the profile or score cannot be saved", async () => {
    state.failSessionWrite = true
    expect(await assessColorsApplication(input)).toMatchObject({ status: "failed", httpStatus: 503 })
    expect(state.updates.at(-1)?.value).toMatchObject({ metadata: { colors_demo_report_status: "failed", colors_demo_report_failure_stage: "profile_persistence" } })
    expect(state.updates.some(row => (row.value.metadata as Record<string, unknown>)?.colors_demo_report_status === "ready")).toBe(false)
  })

  it("repairs a missing score from a current report without another model call", async () => {
    state.metadata = { colors_demo_report_status: "ready", reviewer_report: report }
    state.session!.profile = { extraction: { status: "ok" } }
    expect(await assessColorsApplication(input)).toEqual({ status: "ready" })
    expect(state.assess).not.toHaveBeenCalled()
    expect(state.updates.find(row => row.table === "sessions")?.value.suitability_score).toBe(0.834)
  })
})

describe("admin assessment status", () => {
  it("marks stale generation retryable and does not enable recovery for unfinished sessions", () => {
    const messages = [{ role: "assistant", metadata: { conversation_engine: "colors_thin_pilot_v1", colors_demo_report_status: "generating", colors_demo_report_started_at: Date.now() - 301_000 } }]
    expect(adminSessionAssessment(messages, true)).toEqual({ supported: true, status: "pending" })
    expect(adminSessionAssessment(messages, false).supported).toBe(false)
  })
})
