import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DetailedReportGenerationError,
  generateDetailedReviewerReport,
} from "@/lib/detailed-reviewer-report"
import { COLORS_DETAILED_REPORT_VERSION, COLORS_FORUM_MEMBERSHIP_REPORT_VERSION } from "@/lib/reviewer-report"
import { auditColorsConversationIntegrity } from "@/lib/colors-post-conversation"
import { extractProfile } from "@/lib/profile-extraction"

const state = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  sessionStatus: "passed",
  metadata: {
    reviewer_report: {
      applicant_bio: "A listener who hosts a listening table.",
      advisory_recommendation: "recommend",
      confidence_score: 0.8,
      evidence_summary: ["Community participation: I host a listening table."],
      evidence_references: [{
        signal_key: "community_participation",
        signal_label: "Community participation",
        source_message_id: "answer-1",
        excerpt: "I host a listening table.",
      }],
      weak_or_missing_signals: [],
      safety_or_integrity_flags: [],
      reviewer_focus: "Review the listening table.",
    },
  } as Record<string, unknown>,
}))

vi.mock("@/lib/colors-demo-token", () => ({
  demoSession: vi.fn(async () => true),
}))

vi.mock("@/lib/colors-demo-access", () => ({
  colorsDemoProject: vi.fn(async () => ({
    context: { projectId: "project-1", organisationId: "org-1" },
  })),
}))

vi.mock("@/lib/request-trace", () => ({
  getOrCreateRequestId: () => "request-1",
}))

vi.mock("@/lib/application-facts", () => ({
  collectApplicationFacts: () => ({ processFeedback: [] }),
}))

vi.mock("@/lib/application-integrity-concerns", () => ({
  collectApplicationIntegrityConcerns: () => [],
}))

vi.mock("@/lib/colors-post-conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/colors-post-conversation")>()),
  auditColorsConversationIntegrity: vi.fn(async () => ({ concerns: [], processMessageIds: [] })),
}))

vi.mock("@/lib/profile-extraction", () => ({
  extractProfile: vi.fn(async () => ({
    schema_version: 1,
    core: null,
    custom: null,
    extraction: { model: "test", status: "ok" },
  })),
}))

vi.mock("@/lib/detailed-reviewer-report", () => {
  class DetailedReportGenerationError extends Error {
    constructor(readonly stage: string, cause: Error) {
      super(cause.message)
    }
  }
  return { DetailedReportGenerationError, generateDetailedReviewerReport: vi.fn() }
})

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        async maybeSingle() {
          return table === "sessions"
            ? { data: { id: "session-row-1", status: state.sessionStatus }, error: null }
            : { data: null, error: null }
        },
        async order() {
          return { data: [
            { id: "answer-1", role: "user", content: "I host a listening table.", metadata: {} },
            { id: "closing-1", role: "assistant", content: "Thank you.", metadata: state.metadata },
          ], error: null }
        },
        update(value: { metadata: Record<string, unknown> }) {
          return {
            async eq() {
              state.metadata = value.metadata
              state.updates.push(value.metadata)
              return { error: null }
            },
          }
        },
      }
      return chain
    },
  },
}))

function request() {
  return new NextRequest("http://localhost/api/demo/colors/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "client-session-1" }),
  })
}

describe("COLORS demo report endpoint", () => {
  beforeEach(() => {
    state.updates = []
    state.sessionStatus = "passed"
    state.metadata = {
      reviewer_report: {
        applicant_bio: "A listener who hosts a listening table.",
        advisory_recommendation: "recommend",
        confidence_score: 0.8,
        evidence_summary: ["Community participation: I host a listening table."],
        evidence_references: [{
          signal_key: "community_participation",
          signal_label: "Community participation",
          source_message_id: "answer-1",
          excerpt: "I host a listening table.",
        }],
        weak_or_missing_signals: [],
        safety_or_integrity_flags: [],
        reviewer_focus: "Review the listening table.",
      },
    }
    vi.mocked(generateDetailedReviewerReport).mockReset()
    vi.mocked(extractProfile).mockReset()
    vi.mocked(extractProfile).mockResolvedValue({
      schema_version: 1,
      core: null,
      custom: null,
      extraction: { model: "test", status: "ok" },
    } as never)
  })

  it("records a precise failure stage without exposing it as a false verification claim", async () => {
    vi.mocked(generateDetailedReviewerReport).mockRejectedValueOnce(
      new DetailedReportGenerationError("draft_model", new Error("provider unavailable")),
    )
    const { POST } = await import("@/app/api/demo/colors/report/route")
    const response = await POST(request())
    const result = await response.json()

    expect(result.status).toBe("failed")
    expect(result.report.evidence_references).toHaveLength(1)
    expect(result.error).toContain("could not be completed")
    expect(result.error).not.toContain("verified")
    expect(state.updates.at(-1)?.colors_demo_report_failure_stage).toBe("draft_model")
  })

  it("identifies a pre-fix cached report and regenerates it on POST", async () => {
    const previous = state.metadata.reviewer_report as Record<string, unknown>
    state.metadata = {
      ...state.metadata,
      application_rubric_version: "colors_forum_v1",
      colors_demo_report_status: "ready",
      reviewer_report: { ...previous, detailed_opinion: {
        overall_assessment: "Old opinion",
        decisive_reasons: [],
        claim_assessments: [{
          claim: "Hosts a table",
          evidence_reference_ids: ["answer-1"],
          interpretation: "Participation",
          assessment: "strength",
        }],
        likely_contribution: "Listening",
        reservations: [],
        reviewer_questions: [],
        suggested_human_action: "approve",
      } },
    }
    const newReport = {
      ...(state.metadata.reviewer_report as Record<string, unknown>),
      report_version: COLORS_DETAILED_REPORT_VERSION,
    }
    vi.mocked(generateDetailedReviewerReport).mockResolvedValueOnce(newReport as never)
    const { GET, POST } = await import("@/app/api/demo/colors/report/route")
    const before = await GET(new NextRequest("http://localhost/api/demo/colors/report?sessionId=client-session-1"))
    expect((await before.json()).outdated).toBe(true)

    const response = await POST(request())
    expect((await response.json()).report.report_version).toBe(COLORS_DETAILED_REPORT_VERSION)
    expect(vi.mocked(generateDetailedReviewerReport)).toHaveBeenCalledWith(
      expect.objectContaining({
        rubricVersion: "colors_forum_v1",
        baseReport: expect.objectContaining({
          advisory_recommendation: "human_review",
          weak_or_missing_signals: [],
          detailed_opinion: undefined,
        }),
      }),
    )
    expect((state.metadata.reviewer_report as Record<string, unknown>).report_version)
      .toBe(COLORS_DETAILED_REPORT_VERSION)
  })

  it("builds the thin pilot report from the completed transcript without a live preliminary score", async () => {
    state.sessionStatus = "completed"
    state.metadata = { conversation_engine: "colors_thin_pilot_v1", colors_demo_report_status: "pending" }
    const completedReport = {
      applicant_bio: "An attentive listener.",
      advisory_recommendation: "recommend",
      confidence_score: 0.8,
      evidence_summary: [],
      evidence_references: [{
        signal_key: "conversation_context",
        signal_label: "Conversation context",
        source_message_id: "answer-1",
        excerpt: "I host a listening table.",
      }],
      weak_or_missing_signals: [],
      safety_or_integrity_flags: [],
      reviewer_focus: "Review the exchange.",
      report_version: COLORS_FORUM_MEMBERSHIP_REPORT_VERSION,
      detailed_opinion: {
        overall_assessment: "The applicant described a listening practice.",
        decisive_reasons: [], claim_assessments: [], likely_contribution: "Listening",
        reservations: [], reviewer_questions: [], suggested_human_action: "approve",
      },
    }
    vi.mocked(generateDetailedReviewerReport).mockResolvedValueOnce(completedReport as never)
    const { POST } = await import("@/app/api/demo/colors/report/route")
    const response = await POST(request())
    expect((await response.json()).status).toBe("ready")
    expect(vi.mocked(auditColorsConversationIntegrity)).toHaveBeenCalled()
    expect(vi.mocked(auditColorsConversationIntegrity)).toHaveBeenCalledWith(
      expect.objectContaining({ forumMembershipPilot: true }),
    )
    expect(vi.mocked(generateDetailedReviewerReport)).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: "claude-sonnet-5-5",
        forumMembershipPilot: true,
        rubricVersion: "colors_forum_membership_v1",
        baseReport: expect.objectContaining({
          evidence_references: [expect.objectContaining({ source_message_id: "answer-1" })],
        }),
      }),
    )
    expect(vi.mocked(extractProfile)).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: expect.objectContaining({
          profile_schema: expect.objectContaining({
            properties: expect.objectContaining({ tones_connection: expect.any(Object) }),
          }),
        }),
      }),
    )
  })

  it("marks the earlier membership report outdated and regenerates it", async () => {
    state.sessionStatus = "completed"
    const oldReport = state.metadata.reviewer_report as Record<string, unknown>
    state.metadata = {
      conversation_engine: "colors_thin_pilot_v1",
      colors_demo_report_status: "ready",
      reviewer_report: { ...oldReport, report_version: "colors_forum_membership_report_v1",
        detailed_opinion: {
          overall_assessment: "Old opinion", decisive_reasons: [], claim_assessments: [{
            claim: "Hosts a listening table", evidence_reference_ids: ["answer-1"],
            interpretation: "Describes community participation", assessment: "strength",
          }],
          likely_contribution: "Listening", reservations: [], reviewer_questions: [],
          suggested_human_action: "approve",
        },
      },
    }
    const next = {
      ...(state.metadata.reviewer_report as Record<string, unknown>),
      report_version: COLORS_FORUM_MEMBERSHIP_REPORT_VERSION,
    }
    vi.mocked(generateDetailedReviewerReport).mockResolvedValueOnce(next as never)
    const { GET, POST } = await import("@/app/api/demo/colors/report/route")
    const before = await GET(new NextRequest("http://localhost/api/demo/colors/report?sessionId=client-session-1"))
    expect((await before.json()).outdated).toBe(true)
    const after = await POST(request())
    expect((await after.json()).report.report_version).toBe(COLORS_FORUM_MEMBERSHIP_REPORT_VERSION)
    expect(vi.mocked(generateDetailedReviewerReport)).toHaveBeenCalledWith(
      expect.objectContaining({ rubricVersion: "colors_forum_membership_v1" }),
    )
  })

  it("keeps the thin report retryable when profile extraction fails", async () => {
    state.sessionStatus = "completed"
    state.metadata = { conversation_engine: "colors_thin_pilot_v1", colors_demo_report_status: "pending" }
    vi.mocked(generateDetailedReviewerReport).mockResolvedValueOnce({ detailed_opinion: {} } as never)
    vi.mocked(extractProfile).mockResolvedValueOnce({
      extraction: { status: "failed", reason: "provider unavailable" },
    } as never)
    const { POST } = await import("@/app/api/demo/colors/report/route")
    const response = await POST(request())
    expect((await response.json()).status).toBe("failed")
    expect(state.updates.at(-1)?.colors_demo_report_failure_stage).toBe("profile_extraction")
  })
})
