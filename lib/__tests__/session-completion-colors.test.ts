import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  recordVerdict: vi.fn(),
  recordCulturalSignals: vi.fn(),
  recordDecision: vi.fn(),
  assess: vi.fn(),
  closingMetadata: {} as Record<string, unknown>,
  sessionProfile: null as unknown,
  thin: true,
}))

vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/verdict-webhook", () => ({
  recordVerdictAndEnqueueWebhooks: (...args: unknown[]) => mocks.recordVerdict(...args),
}))
vi.mock("@/lib/cultural-signals", () => ({
  recordCompletedSessionCulturalSignals: (...args: unknown[]) => mocks.recordCulturalSignals(...args),
}))
vi.mock("@/lib/automatic-application-decision", () => ({
  recordAutomaticApplicationDecision: (...args: unknown[]) => mocks.recordDecision(...args),
}))
vi.mock("@/lib/colors-thin-assessment", async (original) => ({
  ...await original<typeof import("@/lib/colors-thin-assessment")>(),
  generateColorsThinAssessment: (...args: unknown[]) => mocks.assess(...args),
}))

function single(data: unknown) {
  const chain = { eq: () => chain, maybeSingle: async () => ({ data, error: null }) }
  return chain
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        mocks.updates.push({ table, payload })
        const promise = Promise.resolve({ error: null })
        const chain = { eq: () => chain, then: promise.then.bind(promise) }
        return chain
      },
      select: () => {
        if (table === "sessions") {
          return single({
            id: "session_internal", session_id: "client_session", status: "completed", persona_id: null,
            applicant_email: "person@example.com", applicant_name: "Person", applicant_details: null,
            application_audience: "community", profile: mocks.sessionProfile,
          })
        }
        if (table === "projects") return single({ settings: { decision_policy: { automatic_acceptance_enabled: true } } })
        if (table === "messages") {
          const engine = mocks.thin ? { conversation_engine: "colors_thin_pilot_v1" } : {}
          const chain = {
            eq: () => chain,
            order: async () => ({
              data: [
                { id: "opening", role: "assistant", content: "Why do you want to join?", metadata: engine },
                { id: "answer", role: "user", content: "I swap drafts with two friends.", metadata: engine },
                { id: "closing", role: "assistant", content: "Swapping drafts sounds careful.", metadata: { ...engine, ...mocks.closingMetadata } },
              ],
              error: null,
            }),
          }
          return chain
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }),
  },
}))

import { processPendingSessionCompletionJobs } from "@/lib/session-completion-jobs"
import { COLORS_FORUM_MEMBERSHIP_REPORT_VERSION } from "@/lib/reviewer-report"

const report = {
  applicant_bio: "Swaps drafts with two friends.",
  advisory_recommendation: "recommend",
  confidence_score: 0.78,
  evidence_summary: ["Swaps drafts with two friends."],
  evidence_references: [{ signal_key: "participation", signal_label: "Participation", source_message_id: "answer", excerpt: "I swap drafts with two friends." }],
  weak_or_missing_signals: [],
  safety_or_integrity_flags: [],
  reviewer_focus: "Check Forum hopes.",
  detailed_opinion: {
    overall_assessment: "Positive, concrete evidence.",
    likely_contribution: "Careful feedback on drafts.",
    claim_assessments: [{ claim: "Swaps drafts", interpretation: "A regular exchange", assessment: "strength", evidence_reference_ids: ["answer"] }],
    suggested_human_action: "approve",
  },
  report_version: COLORS_FORUM_MEMBERSHIP_REPORT_VERSION,
}
const profile = { schema_version: 1, core: null, custom: { joining_reason: "feedback" }, extraction: { status: "ok" } }
const job = { id: "job_1", organisation_id: "org_1", project_id: "project_1", session_id: "session_internal", likely_bot: false, attempt_count: 1, max_attempts: 8 }

describe("completion for the newer COLORS engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updates = []
    mocks.closingMetadata = { application_closing: true, colors_demo_report_status: "pending" }
    mocks.sessionProfile = null
    mocks.thin = true
    mocks.rpc.mockResolvedValue({ data: [job], error: null })
    mocks.assess.mockResolvedValue({ report, profile })
    mocks.recordVerdict.mockResolvedValue({ profile })
    mocks.recordCulturalSignals.mockResolvedValue(undefined)
    mocks.recordDecision.mockResolvedValue({ reviewStatus: "approved" })
  })

  it("assesses the conversation, derives suitability and runs decision, verdict and webhooks", async () => {
    await processPendingSessionCompletionJobs(1)

    expect(mocks.assess).toHaveBeenCalledWith(expect.objectContaining({ terminalStatus: "completed", sessionKey: "client_session" }))
    expect(mocks.updates).toContainEqual({ table: "sessions", payload: expect.objectContaining({ profile }) })
    expect(mocks.updates).toContainEqual({ table: "messages", payload: { metadata: expect.objectContaining({ reviewer_report: report, colors_demo_report_status: "ready" }) } })
    expect(mocks.updates).toContainEqual({ table: "sessions", payload: { suitability_score: 0.834 } })
    expect(mocks.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ suitabilityScore: 0.834, advisoryRecommendation: "recommend" }))
    expect(mocks.recordVerdict).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: "completed", outcome: "PASS", suitabilityScore: 0.834, reviewerReport: report, profile,
      applicant: { email: "person@example.com", name: "Person" },
    }))
    expect(mocks.recordVerdict.mock.calls[0][0].scores).toBeUndefined()
    expect(mocks.recordCulturalSignals).toHaveBeenCalled()
    expect(mocks.updates).toContainEqual({ table: "session_completion_jobs", payload: expect.objectContaining({ status: "completed" }) })
  })

  it("reuses a report and profile the demo page already produced", async () => {
    mocks.closingMetadata = { colors_demo_report_status: "ready", reviewer_report: report }
    mocks.sessionProfile = profile
    await processPendingSessionCompletionJobs(1)
    expect(mocks.assess).not.toHaveBeenCalled()
    expect(mocks.recordVerdict).toHaveBeenCalledWith(expect.objectContaining({ outcome: "PASS", profile }))
  })

  it("waits for an assessment that is already being generated", async () => {
    mocks.closingMetadata = { colors_demo_report_status: "generating", colors_demo_report_started_at: Date.now() }
    await processPendingSessionCompletionJobs(1)
    expect(mocks.assess).not.toHaveBeenCalled()
    expect(mocks.recordVerdict).not.toHaveBeenCalled()
    expect(mocks.updates).toContainEqual({ table: "session_completion_jobs", payload: expect.objectContaining({ status: "pending" }) })
  })

  it("records the failed stage and retries when the assessment fails", async () => {
    const { ColorsAssessmentError } = await import("@/lib/colors-thin-assessment")
    mocks.assess.mockRejectedValue(new ColorsAssessmentError("report_generation", new Error("model unavailable")))
    await processPendingSessionCompletionJobs(1)
    expect(mocks.updates).toContainEqual({ table: "messages", payload: { metadata: expect.objectContaining({ colors_demo_report_status: "failed", colors_demo_report_failure_stage: "report_generation" }) } })
    expect(mocks.recordVerdict).not.toHaveBeenCalled()
    expect(mocks.updates).toContainEqual({ table: "session_completion_jobs", payload: expect.objectContaining({ status: "pending" }) })
  })

  it("maps human review to the review band and the REDIRECT compatibility outcome", async () => {
    mocks.assess.mockResolvedValue({ report: { ...report, advisory_recommendation: "human_review", confidence_score: 0.6 }, profile })
    await processPendingSessionCompletionJobs(1)
    expect(mocks.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ suitabilityScore: 0.58 }))
    expect(mocks.recordVerdict).toHaveBeenCalledWith(expect.objectContaining({ outcome: "REDIRECT" }))
  })

  it("refuses to complete an old-engine session that has no outcome", async () => {
    mocks.thin = false
    await processPendingSessionCompletionJobs(1)
    expect(mocks.recordVerdict).not.toHaveBeenCalled()
    expect(mocks.updates).toContainEqual({ table: "session_completion_jobs", payload: expect.objectContaining({ status: "pending" }) })
  })
})
