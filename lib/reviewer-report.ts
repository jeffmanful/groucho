import type { ApplicationParticipantOrientationState } from "@/lib/application-participant-orientation"
import type {
  ApplicationSignalAnswer,
  ApplicationSignalDefinition,
} from "@/lib/application-signal-state"

export type AdvisoryRecommendation = "recommend" | "human_review" | "decline"

export type ReviewerReport = {
  applicant_bio: string
  advisory_recommendation: AdvisoryRecommendation
  confidence_score: number
  evidence_summary: string[]
  weak_or_missing_signals: string[]
  safety_or_integrity_flags: string[]
  reviewer_focus: string
}

type ScoreLike = {
  overall: number
}

const RECOMMENDATIONS = new Set<AdvisoryRecommendation>([
  "recommend",
  "human_review",
  "decline",
])

const MAX_TEXT_LENGTH = 800
const MAX_ITEMS = 8

function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT_LENGTH)
}

function cleanTextArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(cleanText)
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
}

function cleanConfidence(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null
  return Math.max(0, Math.min(1, raw))
}

export function normaliseReviewerReport(raw: unknown): ReviewerReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const applicantBio = cleanText(data.applicant_bio)
  const recommendation = data.advisory_recommendation
  const confidenceScore = cleanConfidence(data.confidence_score)
  const reviewerFocus = cleanText(data.reviewer_focus)

  if (
    !applicantBio ||
    !RECOMMENDATIONS.has(recommendation as AdvisoryRecommendation) ||
    confidenceScore === null ||
    !reviewerFocus
  ) {
    return null
  }

  return {
    applicant_bio: applicantBio,
    advisory_recommendation: recommendation as AdvisoryRecommendation,
    confidence_score: confidenceScore,
    evidence_summary: cleanTextArray(data.evidence_summary),
    weak_or_missing_signals: cleanTextArray(data.weak_or_missing_signals),
    safety_or_integrity_flags: cleanTextArray(data.safety_or_integrity_flags),
    reviewer_focus: reviewerFocus,
  }
}

export function fallbackReviewerReport(input: {
  terminalStatus: "passed" | "redirected" | "rejected"
  scores: ScoreLike
}): ReviewerReport {
  const advisoryRecommendation: AdvisoryRecommendation =
    input.terminalStatus === "passed"
      ? "recommend"
      : input.terminalStatus === "rejected"
        ? "decline"
        : "human_review"
  const confidence = Math.min(
    0.6,
    Math.max(0.2, Number.isFinite(input.scores.overall) ? input.scores.overall : 0.4),
  )
  return {
    applicant_bio:
      "Applicant completed the application. Groucho did not return a structured applicant bio, so this report was generated as a fallback.",
    advisory_recommendation: advisoryRecommendation,
    confidence_score: confidence,
    evidence_summary: [],
    weak_or_missing_signals: [
      "Structured reviewer report was missing or malformed on the terminal turn.",
    ],
    safety_or_integrity_flags: [],
    reviewer_focus:
      "Review the transcript manually before making any community decision.",
  }
}

function recommendationForStatus(
  status: "passed" | "redirected" | "rejected",
): AdvisoryRecommendation {
  return status === "passed"
    ? "recommend"
    : status === "rejected"
      ? "decline"
      : "human_review"
}

function evidenceExcerpt(answer: string): string {
  return answer.trim().replace(/\s+/g, " ").slice(0, 260)
}

/**
 * Repairs missing or evidence-free model reports from the application state
 * already persisted in message metadata. It never invents applicant evidence.
 */
export function ensureEvidenceBackedReviewerReport(input: {
  report: ReviewerReport | null
  terminalStatus: "passed" | "redirected" | "rejected"
  scores: ScoreLike
  definitions: ApplicationSignalDefinition[]
  answers: ApplicationSignalAnswer[]
  insufficientEvidenceKeys?: Set<string>
  orientation?: ApplicationParticipantOrientationState
}): ReviewerReport {
  if (input.report?.evidence_summary.length) {
    return {
      ...input.report,
      advisory_recommendation: recommendationForStatus(input.terminalStatus),
    }
  }

  const answerByKey = new Map(input.answers.map((answer) => [answer.key, answer]))
  const evidenceSummary = input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    return answer?.covered !== false && answer?.answer.trim()
      ? [`${signal.label}: ${evidenceExcerpt(answer.answer)}`]
      : []
  }).slice(0, MAX_ITEMS)
  const weakOrMissingSignals = input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    if (answer?.covered !== false) return []
    return [
      input.insufficientEvidenceKeys?.has(signal.key)
        ? `${signal.label}: insufficient evidence after the available follow-ups.`
        : `${signal.label}: no usable evidence was established.`,
    ]
  }).slice(0, MAX_ITEMS)
  const orientation = input.orientation?.primary ?? "unknown"
  const orientationLabel =
    orientation === "unknown" ? "an unresolved participant orientation" : `a primarily ${orientation} orientation`
  const usableCount = evidenceSummary.length
  const relevantCount = input.definitions.length
  const fallback = fallbackReviewerReport({
    terminalStatus: input.terminalStatus,
    scores: input.scores,
  })
  const coverage = relevantCount > 0 ? usableCount / relevantCount : 0
  const confidence = Math.max(
    0.2,
    Math.min(0.9, input.scores.overall * 0.65 + coverage * 0.35),
  )

  return {
    applicant_bio:
      input.report?.applicant_bio ||
      `Applicant presented with ${orientationLabel}. Usable evidence was established across ${usableCount} of ${relevantCount} relevant areas.`,
    advisory_recommendation: recommendationForStatus(input.terminalStatus),
    confidence_score: Number(confidence.toFixed(2)),
    evidence_summary: evidenceSummary,
    weak_or_missing_signals: weakOrMissingSignals,
    safety_or_integrity_flags:
      input.report?.safety_or_integrity_flags ?? fallback.safety_or_integrity_flags,
    reviewer_focus:
      input.report?.reviewer_focus ||
      (weakOrMissingSignals.length
        ? "Review the concrete evidence alongside the unresolved areas before making the community decision."
        : "Review whether the concrete evidence and proposed participation fit the Forum's needs."),
  }
}
