import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upsert: vi.fn(),
  jobUpdate: vi.fn(),
  recordVerdict: vi.fn(),
  recordCulturalSignals: vi.fn(),
}))

vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/verdict-webhook", () => ({
  recordVerdictAndEnqueueWebhooks: (...args: unknown[]) =>
    mocks.recordVerdict(...args),
}))
vi.mock("@/lib/cultural-signals", () => ({
  recordCompletedSessionCulturalSignals: (...args: unknown[]) =>
    mocks.recordCulturalSignals(...args),
}))

function filteredSingle(data: unknown) {
  const chain = {
    eq: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  }
  return chain
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: (table: string) => ({
      upsert: (...args: unknown[]) => mocks.upsert(table, ...args),
      update: (payload: unknown) => ({
        eq: async () => mocks.jobUpdate(table, payload),
      }),
      select: () => {
        if (table === "sessions") {
          return filteredSingle({
            id: "session_internal",
            session_id: "client_session",
            status: "passed",
            persona_id: "persona_1",
            applicant_email: "person@example.com",
            applicant_name: "Person",
          })
        }
        if (table === "projects") {
          return filteredSingle({ settings: { cultural_signals: { enabled: true } } })
        }
        if (table === "personas") {
          return filteredSingle({
            profile_schema: null,
            profile_extractor_hint: null,
          })
        }
        if (table === "messages") {
          const chain = {
            eq: () => chain,
            order: async () => ({
              data: [
                {
                  id: "user_1",
                  role: "user",
                  content: "I run a listening night.",
                  metadata: {
                    scores: {
                      specificity: 0.8,
                      authenticity: 0.8,
                      cultural_depth: 0.8,
                      overall: 0.8,
                    },
                  },
                },
                {
                  id: "assistant_1",
                  role: "assistant",
                  content: "It was good getting to understand you better.",
                  metadata: {
                    scores: {
                      specificity: 0.8,
                      authenticity: 0.8,
                      cultural_depth: 0.8,
                      overall: 0.8,
                    },
                    reviewer_report: {
                      applicant_bio: "Runs a listening night.",
                      advisory_recommendation: "recommend",
                      confidence_score: 0.8,
                      evidence_summary: ["Runs a listening night."],
                      evidence_references: [],
                      weak_or_missing_signals: [],
                      safety_or_integrity_flags: [],
                      reviewer_focus: "Review their participation.",
                    },
                  },
                },
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

import {
  enqueueSessionCompletionJob,
  processPendingSessionCompletionJobs,
} from "@/lib/session-completion-jobs"

describe("session completion jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsert.mockResolvedValue({ error: null })
    mocks.jobUpdate.mockResolvedValue({ error: null })
    mocks.recordVerdict.mockResolvedValue({ profile: null })
    mocks.recordCulturalSignals.mockResolvedValue(undefined)
  })

  it("enqueues one idempotent job per terminal session", async () => {
    await enqueueSessionCompletionJob({
      organisationId: "org_1",
      projectId: "project_1",
      sessionId: "session_internal",
      likelyBot: false,
    })

    expect(mocks.upsert).toHaveBeenCalledWith(
      "session_completion_jobs",
      expect.objectContaining({
        organisation_id: "org_1",
        project_id: "project_1",
        session_id: "session_internal",
        status: "pending",
      }),
      { onConflict: "session_id", ignoreDuplicates: true },
    )
  })

  it("hydrates a claimed job and completes reviewer, profile, webhook, and cultural work", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: "job_1",
          organisation_id: "org_1",
          project_id: "project_1",
          session_id: "session_internal",
          likely_bot: false,
          attempt_count: 1,
          max_attempts: 8,
        },
      ],
      error: null,
    })

    await expect(processPendingSessionCompletionJobs(1)).resolves.toBe(1)
    expect(mocks.recordVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionInternalId: "session_internal",
        clientSessionKey: "client_session",
        terminalStatus: "passed",
        scores: {
          specificity: 0.8,
          authenticity: 0.8,
          cultural_depth: 0.8,
          overall: 0.8,
        },
        reviewerReport: expect.objectContaining({
          advisory_recommendation: "recommend",
        }),
      }),
    )
    expect(mocks.recordCulturalSignals).toHaveBeenCalled()
    expect(mocks.jobUpdate).toHaveBeenCalledWith(
      "session_completion_jobs",
      expect.objectContaining({ status: "completed" }),
    )
  })
})
