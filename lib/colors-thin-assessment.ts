import { collectApplicationFacts } from "@/lib/application-facts"
import { COLORS_FORUM_MEMBERSHIP_RUBRIC } from "@/lib/application-signal-state"
import { applicantAsksQuestion } from "@/lib/colors-engine"
import { auditColorsConversationIntegrity, groundColorsProfile } from "@/lib/colors-post-conversation"
import { DetailedReportGenerationError, generateDetailedReviewerReport } from "@/lib/detailed-reviewer-report"
import { modelFromEnv } from "@/lib/llm-usage"
import {
  COLORS_FORUM_MEMBERSHIP_PROFILE_HINT,
  COLORS_FORUM_MEMBERSHIP_PROFILE_SCHEMA,
  COLORS_THIN_PROFILE_EVIDENCE_HINT,
} from "@/lib/onboarding-persona-template"
import { extractProfile } from "@/lib/profile-extraction"
import type { ReviewerReport } from "@/lib/reviewer-report"

export type ColorsAssessmentMessage = {
  id: string
  role: string
  content: string
  metadata: unknown
}

/** A failure in one named stage, so callers can record where the assessment stopped. */
export class ColorsAssessmentError extends Error {
  constructor(readonly stage: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = "ColorsAssessmentError"
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * The private reviewer report and grounded membership profile for a finished conversation on the
 * newer COLORS engine. Shared by the demo report route and the background completion job so both
 * produce the same assessment. Nothing is persisted here.
 */
export async function generateColorsThinAssessment(input: {
  rows: ColorsAssessmentMessage[]
  baseReport: ReviewerReport
  terminalStatus: string
  requestId?: string
  organisationId: string
  projectId: string
  /** The client session key, used for logging and usage attribution. */
  sessionKey: string
}): Promise<{ report: ReviewerReport; profile: ReturnType<typeof groundColorsProfile> }> {
  const ids = {
    requestId: input.requestId,
    organisationId: input.organisationId,
    projectId: input.projectId,
    sessionId: input.sessionKey,
  }
  const transcriptRows = input.rows.filter((message): message is ColorsAssessmentMessage & { role: "user" | "assistant" } =>
    message.role === "user" || message.role === "assistant",
  )
  const lastAssistant = [...transcriptRows].reverse().find((message) => message.role === "assistant")
  const lastApplicantMessage = [...transcriptRows].reverse().find((message) => message.role === "user")
  const grouchoClosedWithQuestionPending =
    record(lastAssistant?.metadata).application_closing === true &&
    applicantAsksQuestion(lastApplicantMessage?.content ?? "")

  let stage = "integrity_audit"
  try {
    const postAudit = await auditColorsConversationIntegrity({
      messages: transcriptRows,
      forumMembershipPilot: true,
      ...ids,
    })
    stage = "report_generation"
    const report = await generateDetailedReviewerReport({
      transcript: transcriptRows.map(({ id, role, content }) => ({ id, role, content })),
      baseReport: {
        ...input.baseReport,
        safety_or_integrity_flags: [...new Set(postAudit.concerns.map((concern) => concern.reviewerFlag).filter(Boolean))],
      },
      facts: collectApplicationFacts(transcriptRows),
      integrityObservations: postAudit.concerns,
      excludedApplicantMessageIds: input.rows.flatMap((message) =>
        message.role === "user" && record(message.metadata).application_media_request
          ? [message.id]
          : [],
      ).concat(postAudit.processMessageIds),
      ...ids,
      terminalStatus: input.terminalStatus,
      grouchoClosedWithQuestionPending,
      rubricVersion: COLORS_FORUM_MEMBERSHIP_RUBRIC,
      forumMembershipPilot: true,
      modelOverride: modelFromEnv("GROUCHO_COLORS_THIN_REVIEWER_MODEL", "claude-sonnet-5-5"),
    })
    stage = "report_validation"
    if (!report.detailed_opinion) throw new Error("Detailed report was empty")
    stage = "profile_extraction"
    const profile = await extractProfile({
      transcript: transcriptRows.map(({ role, content }) => ({ role, content })),
      persona: {
        profile_schema: COLORS_FORUM_MEMBERSHIP_PROFILE_SCHEMA,
        profile_extractor_hint: `${COLORS_FORUM_MEMBERSHIP_PROFILE_HINT} ${COLORS_THIN_PROFILE_EVIDENCE_HINT}`,
      },
      ...ids,
      terminalStatus: input.terminalStatus,
    })
    if (profile.extraction.status !== "ok") throw new Error(profile.extraction.reason)
    return { report, profile: groundColorsProfile(profile, postAudit.concerns, report) }
  } catch (error) {
    throw new ColorsAssessmentError(error instanceof DetailedReportGenerationError ? error.stage : stage, error)
  }
}
