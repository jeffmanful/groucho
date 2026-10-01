import type {
  ApplicationSignalAnswer,
  ApplicationSignalDefinition,
  ApplicationSignalMessage,
} from "@/lib/application-signal-state"

export type AdvisoryRecommendation = "recommend" | "human_review" | "decline"

export type ReviewerEvidenceReference = {
  signal_key: string
  signal_label: string
  source_message_id: string
  excerpt: string
  preceding_question?: string
}

export type ReviewerClaimAssessment = {
  claim: string
  evidence_reference_ids: string[]
  interpretation: string
  assessment: "strength" | "concern" | "context"
}

export type DetailedReviewerOpinion = {
  overall_assessment: string
  decisive_reasons: string[]
  claim_assessments: ReviewerClaimAssessment[]
  likely_contribution: string
  reservations: string[]
  reviewer_questions: string[]
  suggested_human_action:
    | "approve"
    | "discuss"
    | "request_clarification"
    | "decline"
}

export type ReviewerReport = {
  applicant_bio: string
  advisory_recommendation: AdvisoryRecommendation
  confidence_score: number
  evidence_summary: string[]
  evidence_references: ReviewerEvidenceReference[]
  weak_or_missing_signals: string[]
  safety_or_integrity_flags: string[]
  reviewer_focus: string
  detailed_opinion?: DetailedReviewerOpinion
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
const MAX_EVIDENCE_LENGTH = 4000
const MAX_ITEMS = 8

const CLAIM_ASSESSMENTS = new Set(["strength", "concern", "context"])
const HUMAN_ACTIONS = new Set([
  "approve",
  "discuss",
  "request_clarification",
  "decline",
])

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

function cleanEvidenceReferences(raw: unknown): ReviewerEvidenceReference[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const value = item as Record<string, unknown>
    const signalKey = cleanText(value.signal_key)
    const signalLabel = cleanText(value.signal_label)
    const sourceMessageId = cleanText(value.source_message_id)
    const excerpt = typeof value.excerpt === "string"
      ? value.excerpt.trim().slice(0, MAX_EVIDENCE_LENGTH) : ""
    const precedingQuestion = cleanText(value.preceding_question)
    return signalKey && signalLabel && sourceMessageId && excerpt
      ? [{
          signal_key: signalKey,
          signal_label: signalLabel,
          source_message_id: sourceMessageId,
          excerpt,
          ...(precedingQuestion ? { preceding_question: precedingQuestion } : {}),
        }]
      : []
  }).slice(0, MAX_ITEMS * 2)
}

function cleanConfidence(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null
  return Math.max(0, Math.min(1, raw))
}

export function normaliseDetailedReviewerOpinion(
  raw: unknown,
  allowedEvidenceIds?: Set<string>,
): DetailedReviewerOpinion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const overallAssessment = cleanText(data.overall_assessment)
  const likelyContribution = cleanText(data.likely_contribution)
  const suggestedHumanAction = data.suggested_human_action
  const claimAssessments = Array.isArray(data.claim_assessments)
    ? data.claim_assessments.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const value = item as Record<string, unknown>
        const claim = cleanText(value.claim)
        const interpretation = cleanText(value.interpretation)
        const assessment = value.assessment
        const evidenceReferenceIds = Array.isArray(value.evidence_reference_ids)
          ? [...new Set(value.evidence_reference_ids.flatMap((id) => {
              const cleaned = cleanText(id)
              if (!cleaned || (allowedEvidenceIds && !allowedEvidenceIds.has(cleaned))) {
                return []
              }
              return [cleaned]
            }))].slice(0, MAX_ITEMS)
          : []
        return claim &&
          interpretation &&
          evidenceReferenceIds.length > 0 &&
          CLAIM_ASSESSMENTS.has(assessment as string)
          ? [{
              claim,
              evidence_reference_ids: evidenceReferenceIds,
              interpretation,
              assessment: assessment as ReviewerClaimAssessment["assessment"],
            }]
          : []
      }).slice(0, 3)
    : []

  if (
    !overallAssessment ||
    !likelyContribution ||
    claimAssessments.length === 0 ||
    !HUMAN_ACTIONS.has(suggestedHumanAction as string)
  ) {
    return null
  }

  return {
    overall_assessment: overallAssessment,
    decisive_reasons: cleanTextArray(data.decisive_reasons).slice(0, 2),
    claim_assessments: claimAssessments,
    likely_contribution: likelyContribution,
    reservations: cleanTextArray(data.reservations).slice(0, 2),
    reviewer_questions: cleanTextArray(data.reviewer_questions).slice(0, 2),
    suggested_human_action:
      suggestedHumanAction as DetailedReviewerOpinion["suggested_human_action"],
  }
}

export function normaliseReviewerReport(raw: unknown): ReviewerReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const applicantBio = cleanText(data.applicant_bio)
  const recommendation = data.advisory_recommendation
  const confidenceScore = cleanConfidence(data.confidence_score)
  const reviewerFocus = cleanText(data.reviewer_focus)
  const detailedOpinion = normaliseDetailedReviewerOpinion(data.detailed_opinion)

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
    evidence_references: cleanEvidenceReferences(data.evidence_references),
    weak_or_missing_signals: cleanTextArray(data.weak_or_missing_signals),
    safety_or_integrity_flags: cleanTextArray(data.safety_or_integrity_flags),
    reviewer_focus: reviewerFocus,
    ...(detailedOpinion ? { detailed_opinion: detailedOpinion } : {}),
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
    evidence_references: [],
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

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function transcriptEvidence(
  messages: ApplicationSignalMessage[],
): Array<{
  id: string
  excerpt: string
  signalKey: string
  signalLabel: string
  quality: string | null
}> {
  return messages.flatMap((message) => {
    if (message.role !== "user" || !message.id || !message.content.trim()) return []
    const metadata = metadataRecord(message.metadata)
    const signal = metadataRecord(metadata?.application_signal)
    const assessment = metadataRecord(metadata?.answer_assessment)
    return [{
      id: message.id,
      excerpt: evidenceExcerpt(message.content),
      signalKey:
        typeof signal?.key === "string" ? signal.key : "conversation_context",
      signalLabel:
        typeof signal?.label === "string"
          ? signal.label
          : "Conversation context",
      quality:
        typeof assessment?.quality === "string" ? assessment.quality : null,
    }]
  })
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
  messages?: ApplicationSignalMessage[]
  insufficientEvidenceKeys?: Set<string>
  integrityFlags?: string[]
  serverControlledFieldsOnly?: boolean
}): ReviewerReport {
  const answerByKey = new Map(input.answers.map((answer) => [answer.key, answer]))
  const coveredEvidenceSummary = input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    return answer?.covered !== false && answer?.answer.trim()
      ? [`${signal.label}: ${evidenceExcerpt(answer.answer)}`]
      : []
  })
  const coveredEvidenceReferences = input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    if (!answer || answer.covered === false) return []
    return (answer?.sources ?? []).map((source) => ({
      signal_key: signal.key,
      signal_label: signal.label,
      source_message_id: source.messageId,
      excerpt: source.excerpt,
    }))
  })
  const coveredSourceIds = new Set(
    coveredEvidenceReferences.map((reference) => reference.source_message_id),
  )
  const additionalTranscriptEvidence = transcriptEvidence(input.messages ?? [])
    .filter((item) => !coveredSourceIds.has(item.id))
  const evidenceSummary = [
    ...coveredEvidenceSummary,
    ...additionalTranscriptEvidence.map((item) =>
      `${item.quality === "thin" ? "Context needing follow-up" : "Additional transcript evidence"}: ${item.excerpt}`,
    ),
  ].slice(0, MAX_ITEMS)
  const candidateReferences = [
    ...coveredEvidenceReferences,
    ...additionalTranscriptEvidence.map((item) => ({
      signal_key: item.signalKey,
      signal_label: item.signalLabel,
      source_message_id: item.id,
      excerpt: item.excerpt,
    })),
  ]
  const messageById = new Map((input.messages ?? [])
    .filter((message) => message.role === "user" && message.id)
    .map((message) => [message.id as string, message]))
  const precedingQuestionById = new Map<string, string>()
  let precedingQuestion = ""
  for (const message of input.messages ?? []) {
    if (message.role === "assistant") precedingQuestion = message.content.trim()
    else if (message.id) precedingQuestionById.set(message.id, precedingQuestion)
  }
  const evidenceReferences = [...new Map(candidateReferences
    .map((reference) => {
      const messageId = reference.source_message_id
      const answer = messageById.get(messageId)
      const question = precedingQuestionById.get(messageId)
      return [messageId, {
        ...reference,
        excerpt: answer?.content.trim().slice(0, MAX_EVIDENCE_LENGTH) ?? reference.excerpt,
        ...(question ? { preceding_question: question } : {}),
      }]
    })).values()].slice(0, MAX_ITEMS * 2)
  const askedKeys = new Set((input.messages ?? []).flatMap((message) => {
    if (message.role !== "assistant") return []
    const next = metadataRecord(metadataRecord(message.metadata)?.application_next_signal)
    return typeof next?.key === "string" ? [next.key] : []
  }))
  const weakOrMissingSignals = input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    if (answer && answer.covered !== false) return []
    return [
      input.insufficientEvidenceKeys?.has(signal.key) || askedKeys.has(signal.key) || Boolean(answer)
        ? `${signal.label}: insufficient evidence after the available follow-ups.`
        : `${signal.label}: not explored in this conversation.`,
    ]
  }).slice(0, MAX_ITEMS)
  const usableCount = coveredEvidenceSummary.length
  const contextualCount = additionalTranscriptEvidence.length
  const fallback = fallbackReviewerReport({
    terminalStatus: input.terminalStatus,
    scores: input.scores,
  })
  const confidence = Math.max(
    0.2,
    Math.min(0.9, input.scores.overall * 0.8 + Math.min(0.1, usableCount * 0.03)),
  )
  const suppliedBio = input.report?.applicant_bio?.trim() ?? ""
  const safeSuppliedBio = input.serverControlledFieldsOnly ? "" : suppliedBio

  return {
    applicant_bio:
      safeSuppliedBio ||
      `Applicant shared ${usableCount} established evidence ${usableCount === 1 ? "area" : "areas"} and ${contextualCount} additional transcript ${contextualCount === 1 ? "statement" : "statements"} that may need reviewer context.`,
    advisory_recommendation: recommendationForStatus(input.terminalStatus),
    confidence_score: Number(confidence.toFixed(2)),
    evidence_summary: evidenceSummary,
    evidence_references: evidenceReferences,
    weak_or_missing_signals: weakOrMissingSignals,
    safety_or_integrity_flags: [...new Set([
      ...(input.serverControlledFieldsOnly
        ? []
        : input.report?.safety_or_integrity_flags ?? fallback.safety_or_integrity_flags),
      ...(input.integrityFlags ?? []),
    ])].slice(0, MAX_ITEMS),
    reviewer_focus:
      (!input.serverControlledFieldsOnly ? input.report?.reviewer_focus : "") ||
      (weakOrMissingSignals.length
        ? "Review the concrete evidence alongside the unresolved areas before making the community decision."
        : "Review whether the concrete evidence and proposed participation fit the Forum's needs."),
  }
}
