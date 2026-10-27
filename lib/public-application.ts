// The shape of an application in the public API (and so the SDK). Never includes access secrets.
import { applicationFromRow, type QueueRow } from "@/lib/application-queue"
import { suitabilityBand, type ClientDecisionPolicy } from "@/lib/decision-policy"

export type PublicApplication = {
  sessionId: string
  status: string
  queue: QueueRow["queue"]
  reviewStatus: "not_ready" | "pending" | "approved" | "declined"
  submittedAt: string
  updatedAt: string
  applicant: ReturnType<typeof applicationFromRow>["applicant"]
  assessment: {
    suitabilityScore: number | null
    suitabilityBand: string | null
    recommendation: "recommend" | "human_review" | "decline" | null
    confidence: number | null
  }
  decision: {
    decision: "approved" | "declined"
    source: "human" | "policy" | null
    via: "dashboard" | "api" | "policy"
    reviewerEmail: string | null
    reason: string | null
    applicantReason: string | null
    corrected: boolean
    decidedAt: string | null
  } | null
  /** The latest outcome your system reported, if any. */
  latestOutcome: { outcome: string; occurredAt: string | null } | null
}

export function publicApplication(row: QueueRow, policy: ClientDecisionPolicy): PublicApplication {
  const item = applicationFromRow(row)
  const score = item.assessment.suitabilityScore === null ? null : Number(item.assessment.suitabilityScore)
  const reviewStatus = item.decision
    ? item.decision.decision
    : row.queue === "ready_for_review" || row.queue === "awaiting_assessment"
      ? "pending"
      : "not_ready"
  return {
    sessionId: item.sessionKey,
    status: item.status,
    queue: item.queue,
    reviewStatus,
    submittedAt: item.createdAt,
    updatedAt: item.updatedAt,
    applicant: item.applicant,
    assessment: {
      suitabilityScore: score,
      suitabilityBand: score === null ? null : suitabilityBand(score, policy),
      recommendation: item.assessment.recommendation,
      confidence: item.assessment.confidence,
    },
    decision: item.decision
      ? {
          decision: item.decision.decision,
          source: item.decision.source,
          via: item.decision.via,
          reviewerEmail: item.decision.reviewer,
          reason: item.decision.reason,
          applicantReason: item.decision.applicantReason,
          corrected: item.decision.corrected,
          decidedAt: item.decision.decidedAt,
        }
      : null,
    latestOutcome: item.latestOutcome ? { outcome: item.latestOutcome.outcome, occurredAt: item.latestOutcome.at } : null,
  }
}
