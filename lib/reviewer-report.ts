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

function cleanEvidenceReferences(raw: unknown): ReviewerEvidenceReference[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const value = item as Record<string, unknown>
    const signalKey = cleanText(value.signal_key)
    const signalLabel = cleanText(value.signal_label)
    const sourceMessageId = cleanText(value.source_message_id)
    const excerpt = cleanText(value.excerpt)
    return signalKey && signalLabel && sourceMessageId && excerpt
      ? [{
          signal_key: signalKey,
          signal_label: signalLabel,
          source_message_id: sourceMessageId,
          excerpt,
        }]
      : []
  }).slice(0, MAX_ITEMS * 2)
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
    evidence_references: cleanEvidenceReferences(data.evidence_references),
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
    if (answer?.covered === false) return []
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
  const evidenceReferences = [
    ...coveredEvidenceReferences,
    ...additionalTranscriptEvidence.map((item) => ({
      signal_key: item.signalKey,
      signal_label: item.signalLabel,
      source_message_id: item.id,
      excerpt: item.excerpt,
    })),
  ].slice(0, MAX_ITEMS * 2)
  const weakOrMissingSignals = input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    if (answer?.covered !== false) return []
    return [
      input.insufficientEvidenceKeys?.has(signal.key)
        ? `${signal.label}: insufficient evidence after the available follow-ups.`
        : `${signal.label}: no usable evidence was established.`,
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
  const safeSuppliedBio =
    suppliedBio &&
    !/\b(?:primarily|primary)\s+(?:an?\s+)?(?:artist|curator|enthusiast|hybrid)\s+orientation\b|\brelevant areas?\b/i.test(
      suppliedBio,
    )
      ? suppliedBio
      : ""

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
      ...(input.report?.safety_or_integrity_flags ?? fallback.safety_or_integrity_flags),
      ...(input.integrityFlags ?? []),
    ])].slice(0, MAX_ITEMS),
    reviewer_focus:
      input.report?.reviewer_focus ||
      (weakOrMissingSignals.length
        ? "Review the concrete evidence alongside the unresolved areas before making the community decision."
        : "Review whether the concrete evidence and proposed participation fit the Forum's needs."),
  }
}
