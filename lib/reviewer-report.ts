import {
  COLORS_FORUM_V1_RUBRIC,
  type ApplicationSignalAnswer,
  type ApplicationSignalDefinition,
  type ApplicationSignalMessage,
} from "@/lib/application-signal-state"
import { isApplicationProcessFeedback } from "@/lib/application-facts"
import {
  normaliseMediaChoiceAnswer,
  normaliseMediaChoiceInteraction,
  normaliseReferenceCards,
  type MediaChoiceMode,
  type ReferenceCard,
} from "@/lib/gatekeeper-interaction-spec"

export type AdvisoryRecommendation = "recommend" | "human_review" | "decline"

export type ReviewerEvidenceReference = {
  signal_key: string
  signal_label: string
  source_message_id: string
  excerpt: string
  preceding_question?: string
  interaction?: ReviewerMediaChoiceEvidence | ReviewerReferenceEvidence
}

export type ReviewerMediaChoiceEvidence = {
  type: "mediaChoice"
  question_id: string
  mode: MediaChoiceMode
  selected_options: Array<{
    id: string
    label: string
    position?: number
  }>
  rationale: string
}

export type ReviewerReferenceEvidence = {
  type: "references"
  cards: ReferenceCard[]
}

export const REVIEWER_CURATION_DIMENSIONS = [
  "sequencing",
  "coherence",
  "audience_awareness",
  "context",
  "tradeoffs",
  "curiosity",
  "reconsideration",
] as const

export type ReviewerCurationDimension =
  (typeof REVIEWER_CURATION_DIMENSIONS)[number]

export type ReviewerCuratorialApproach = {
  present: boolean
  summary: string
  evidence_reference_ids: string[]
  observed_dimensions: ReviewerCurationDimension[]
}

export const REVIEWER_SNAPSHOT_TAGS = [
  "joining_motivation",
  "colors_connection",
  "music_relationship",
  "forum_participation",
  "tones_connection",
  "community_participation",
  "reciprocal_contribution",
  "forum_hopes",
  "artist_engagement",
  "colors_relationship",
  "active_listening",
  "collaboration",
  "connective_thinking",
  "curatorial_sequencing",
  "audience_awareness",
  "context_awareness",
  "curiosity",
  "reflection",
  "practical_contribution",
  "creative_practice",
] as const

export type ReviewerSnapshotTag =
  (typeof REVIEWER_SNAPSHOT_TAGS)[number]

export type ReviewerReportSnapshot = {
  applicant_summary: string
  evidence_reference_ids: string[]
  tags: Array<{
    value: ReviewerSnapshotTag
    evidence_reference_ids: string[]
  }>
}

export type ReviewerClaimAssessment = {
  claim: string
  evidence_reference_ids: string[]
  interpretation: string
  assessment: "strength" | "concern" | "context"
}

export type ReviewerReservation = {
  text: string
  evidence_reference_ids: string[]
}

export type DetailedReviewerOpinion = {
  snapshot?: ReviewerReportSnapshot
  advisory_reason?: string
  advisory_evidence_reference_ids?: string[]
  overall_assessment: string
  decisive_reasons: string[]
  claim_assessments: ReviewerClaimAssessment[]
  likely_contribution: string
  reservations: ReviewerReservation[]
  reviewer_questions: string[]
  curatorial_approach?: ReviewerCuratorialApproach
  suggested_human_action:
    | "approve"
    | "discuss"
    | "request_clarification"
    | "decline"
}

export type ReviewerReport = {
  report_version?: string
  evidence_state?: ReviewerEvidenceStateEntry[]
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

export const COLORS_DETAILED_REPORT_VERSION = "colors_forum_report_v2"
export const COLORS_FORUM_MEMBERSHIP_REPORT_VERSION = "colors_forum_membership_report_v6"

export type ReviewerEvidenceStateEntry = {
  signal_key: string
  coverage: "supported" | "partial" | "unverified"
  source_message_ids: string[]
  material_gap: boolean
  gap_reason: string
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
const MAX_EVIDENCE_REFERENCES = 64

const CLAIM_ASSESSMENTS = new Set(["strength", "concern", "context"])
const HUMAN_ACTIONS = new Set([
  "approve",
  "discuss",
  "request_clarification",
  "decline",
])
const CURATION_DIMENSIONS = new Set<string>(REVIEWER_CURATION_DIMENSIONS)
const SNAPSHOT_TAGS = new Set<string>(REVIEWER_SNAPSHOT_TAGS)

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
    const interaction = cleanMediaChoiceEvidence(value.interaction) ??
      cleanReferenceEvidence(value.interaction)
    return signalKey && signalLabel && sourceMessageId && excerpt
      ? [{
          signal_key: signalKey,
          signal_label: signalLabel,
          source_message_id: sourceMessageId,
          excerpt,
          ...(precedingQuestion ? { preceding_question: precedingQuestion } : {}),
          ...(interaction ? { interaction } : {}),
        }]
      : []
  }).slice(0, MAX_EVIDENCE_REFERENCES)
}

function cleanMediaChoiceEvidence(raw: unknown): ReviewerMediaChoiceEvidence | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const questionId = cleanText(value.question_id)
  const mode = value.mode
  const rationale = cleanText(value.rationale)
  if (
    value.type !== "mediaChoice" ||
    !questionId ||
    (mode !== "select" && mode !== "remove" && mode !== "rank") ||
    !Array.isArray(value.selected_options)
  ) {
    return null
  }
  const selectedOptions = value.selected_options.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const option = item as Record<string, unknown>
    const id = cleanText(option.id)
    const label = cleanText(option.label)
    const position = option.position
    return id && label
      ? [{
          id,
          label,
          ...(typeof position === "number" && Number.isInteger(position) && position > 0
            ? { position }
            : {}),
        }]
      : []
  }).slice(0, 8)
  if (!selectedOptions.length) return null
  return {
    type: "mediaChoice",
    question_id: questionId,
    mode,
    selected_options: selectedOptions,
    rationale,
  }
}

function cleanReferenceEvidence(raw: unknown): ReviewerReferenceEvidence | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.type !== "references") return null
  const cards = normaliseReferenceCards(value.cards)
  return cards ? {
    type: "references",
    cards,
  } : null
}

function cleanConfidence(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null
  return Math.max(0, Math.min(1, raw))
}

function cleanEvidenceIds(
  raw: unknown,
  allowedEvidenceIds?: Set<string>,
): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.flatMap((id) => {
    const cleaned = cleanText(id)
    if (!cleaned || (allowedEvidenceIds && !allowedEvidenceIds.has(cleaned))) {
      return []
    }
    return [cleaned]
  }))].slice(0, MAX_ITEMS)
}

export function normaliseDetailedReviewerOpinion(
  raw: unknown,
  allowedEvidenceIds?: Set<string>,
): DetailedReviewerOpinion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const overallAssessment = cleanText(data.overall_assessment)
  const advisoryReason = cleanText(data.advisory_reason)
  const advisoryEvidenceIds = cleanEvidenceIds(
    data.advisory_evidence_reference_ids,
    allowedEvidenceIds,
  )
  const likelyContribution = cleanText(data.likely_contribution)
  const suggestedHumanAction = data.suggested_human_action
  const snapshotRaw = metadataRecord(data.snapshot)
  const snapshotEvidenceIds = cleanEvidenceIds(
    snapshotRaw?.evidence_reference_ids,
    allowedEvidenceIds,
  )
  const snapshotTags = Array.isArray(snapshotRaw?.tags)
    ? snapshotRaw.tags.flatMap((item) => {
        const tag = metadataRecord(item)
        const value = tag?.value
        const evidenceReferenceIds = cleanEvidenceIds(
          tag?.evidence_reference_ids,
          allowedEvidenceIds,
        )
        return typeof value === "string" &&
          SNAPSHOT_TAGS.has(value) &&
          evidenceReferenceIds.length > 0
          ? [{
              value: value as ReviewerSnapshotTag,
              evidence_reference_ids: evidenceReferenceIds,
            }]
          : []
      }).filter((tag, index, tags) =>
        tags.findIndex((candidate) => candidate.value === tag.value) === index,
      ).slice(0, 5)
    : []
  const snapshot: ReviewerReportSnapshot | undefined = snapshotRaw &&
    cleanText(snapshotRaw.applicant_summary) &&
    snapshotEvidenceIds.length > 0
    ? {
        applicant_summary: cleanText(snapshotRaw.applicant_summary),
        evidence_reference_ids: snapshotEvidenceIds,
        tags: snapshotTags,
      }
    : undefined
  const curatorialRaw = metadataRecord(data.curatorial_approach)
  const curatorialPresent = curatorialRaw?.present === true
  const curatorialEvidenceIds = cleanEvidenceIds(
    curatorialRaw?.evidence_reference_ids,
    allowedEvidenceIds,
  )
  const curatorialApproach: ReviewerCuratorialApproach | undefined = curatorialRaw
    ? {
        present: curatorialPresent,
        summary: cleanText(curatorialRaw.summary),
        evidence_reference_ids: curatorialEvidenceIds,
        observed_dimensions: Array.isArray(curatorialRaw.observed_dimensions)
          ? [...new Set(curatorialRaw.observed_dimensions.filter(
              (dimension): dimension is ReviewerCurationDimension =>
                typeof dimension === "string" && CURATION_DIMENSIONS.has(dimension),
            ))].slice(0, REVIEWER_CURATION_DIMENSIONS.length)
          : [],
      }
    : undefined
  const claimAssessments = Array.isArray(data.claim_assessments)
    ? data.claim_assessments.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const value = item as Record<string, unknown>
        const claim = cleanText(value.claim)
        const interpretation = cleanText(value.interpretation)
        const assessment = value.assessment
        const evidenceReferenceIds = cleanEvidenceIds(
          value.evidence_reference_ids,
          allowedEvidenceIds,
        )
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
  const reservations = Array.isArray(data.reservations)
    ? data.reservations.flatMap((item) => {
        const reservation = metadataRecord(item)
        const text = cleanText(reservation?.text)
        const evidenceReferenceIds = cleanEvidenceIds(
          reservation?.evidence_reference_ids,
          allowedEvidenceIds,
        )
        return text && evidenceReferenceIds.length > 0
          ? [{ text, evidence_reference_ids: evidenceReferenceIds }]
          : []
      }).slice(0, 2)
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
    ...(snapshot ? { snapshot } : {}),
    ...(advisoryReason
      ? {
          advisory_reason: advisoryReason,
          advisory_evidence_reference_ids: advisoryEvidenceIds,
        }
      : {}),
    overall_assessment: overallAssessment,
    decisive_reasons: cleanTextArray(data.decisive_reasons).slice(0, 2),
    claim_assessments: claimAssessments,
    likely_contribution: likelyContribution,
    reservations,
    reviewer_questions: cleanTextArray(data.reviewer_questions).slice(0, 2),
    ...(curatorialApproach ? { curatorial_approach: curatorialApproach } : {}),
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
  const evidenceReferences = cleanEvidenceReferences(data.evidence_references)
  const detailedOpinion = normaliseDetailedReviewerOpinion(
    data.detailed_opinion,
    new Set(evidenceReferences.map((reference) => reference.source_message_id)),
  )

  if (
    !applicantBio ||
    !RECOMMENDATIONS.has(recommendation as AdvisoryRecommendation) ||
    confidenceScore === null ||
    !reviewerFocus
  ) {
    return null
  }

  return {
    ...(typeof data.report_version === "string" ? { report_version: data.report_version } : {}),
    ...(Array.isArray(data.evidence_state) ? {
      evidence_state: data.evidence_state.flatMap((item): ReviewerEvidenceStateEntry[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const state = item as Record<string, unknown>
        if (typeof state.signal_key !== "string" ||
          !["supported", "partial", "unverified"].includes(String(state.coverage)) ||
          !Array.isArray(state.source_message_ids)) return []
        return [{
          signal_key: state.signal_key,
          coverage: state.coverage as ReviewerEvidenceStateEntry["coverage"],
          source_message_ids: state.source_message_ids.filter((id): id is string => typeof id === "string"),
          material_gap: state.material_gap === true,
          gap_reason: cleanText(state.gap_reason),
        }]
      }),
    } : {}),
    applicant_bio: applicantBio,
    advisory_recommendation: recommendation as AdvisoryRecommendation,
    confidence_score: confidenceScore,
    evidence_summary: cleanTextArray(data.evidence_summary),
    evidence_references: evidenceReferences,
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
    if (isApplicationProcessFeedback(message.metadata)) return []
    if (metadata?.application_media_request) return []
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

function mediaChoiceEvidenceByMessageId(
  messages: ApplicationSignalMessage[],
): Map<string, ReviewerMediaChoiceEvidence> {
  const result = new Map<string, ReviewerMediaChoiceEvidence>()
  let activeInteraction: ReturnType<typeof normaliseMediaChoiceInteraction>
  for (const message of messages) {
    if (message.role === "assistant") {
      const ui = metadataRecord(metadataRecord(message.metadata)?.ui)
      activeInteraction = normaliseMediaChoiceInteraction(ui?.mediaChoice)
      continue
    }
    if (!message.id || !activeInteraction) continue
    const answer = normaliseMediaChoiceAnswer(
      metadataRecord(message.metadata)?.interaction_answer,
    )
    if (
      !answer ||
      answer.questionId !== activeInteraction.id ||
      answer.mode !== activeInteraction.selection.mode
    ) {
      continue
    }
    const optionsById = new Map(
      activeInteraction.options.map((option) => [option.id, option]),
    )
    const selectedOptions = answer.optionIds.flatMap((id, index) => {
      const option = optionsById.get(id)
      return option
        ? [{
            id,
            label: option.label,
            ...(answer.mode === "rank" ? { position: index + 1 } : {}),
          }]
        : []
    })
    if (!selectedOptions.length) continue
    result.set(message.id, {
      type: "mediaChoice",
      question_id: answer.questionId,
      mode: answer.mode,
      selected_options: selectedOptions,
      rationale: answer.rationale ?? "",
    })
  }
  return result
}

function referenceEvidenceByMessageId(
  messages: ApplicationSignalMessage[],
): Map<string, ReviewerReferenceEvidence> {
  const result = new Map<string, ReviewerReferenceEvidence>()
  let activeCards: ReferenceCard[] | undefined
  for (const message of messages) {
    if (message.role === "assistant") {
      const ui = metadataRecord(metadataRecord(message.metadata)?.ui)
      activeCards = normaliseReferenceCards(ui?.referenceCards)
    } else if (message.id && activeCards) {
      result.set(message.id, { type: "references", cards: activeCards })
    }
  }
  return result
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
  const versionedForumReport = (input.messages ?? []).some((message) =>
    metadataRecord(message.metadata)?.application_rubric_version === COLORS_FORUM_V1_RUBRIC,
  )
  const definitionsByKey = new Map(input.definitions.map((signal) => [signal.key, signal]))
  const quotedEvidence = (versionedForumReport ? [] : input.messages ?? []).flatMap((message) => {
    if (message.role !== "user" || !message.id || isApplicationProcessFeedback(message.metadata)) return []
    const metadata = metadataRecord(message.metadata)
    const quotes = metadata?.application_evidence_quotes
    if (!Array.isArray(quotes)) return []
    return quotes.flatMap((item) => {
      const evidence = metadataRecord(item)
      const key = typeof evidence?.key === "string" ? evidence.key : ""
      const quote = typeof evidence?.quote === "string" ? evidence.quote.trim() : ""
      const signal = definitionsByKey.get(key)
      if (!signal || !quote || !message.content.toLocaleLowerCase().includes(quote.toLocaleLowerCase())) return []
      return [{
        signal_key: key,
        signal_label: signal.evidenceLabel,
        source_message_id: message.id as string,
        excerpt: quote,
      }]
    })
  })
  const latestQuoteByKey = new Map(quotedEvidence.map((reference) => [
    reference.signal_key,
    reference.excerpt,
  ]))
  const quoteBySourceAndSignal = new Map(quotedEvidence.map((reference) => [
    `${reference.source_message_id}:${reference.signal_key}`,
    reference.excerpt,
  ]))
  const coveredEvidenceSummary = input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    if (versionedForumReport) return []
    return answer?.covered !== false && answer?.answer.trim()
      ? [`${signal.evidenceLabel}: ${latestQuoteByKey.get(signal.key) ?? evidenceExcerpt(answer.answer)}`]
      : []
  })
  const coveredEvidenceReferences = input.definitions.flatMap((signal) => {
    if (versionedForumReport) return []
    const answer = answerByKey.get(signal.key)
    if (!answer || answer.covered === false) return []
    return (answer?.sources ?? []).map((source) => ({
      signal_key: signal.key,
      signal_label: signal.evidenceLabel,
      source_message_id: source.messageId,
      excerpt: source.excerpt,
    }))
  })
  const coveredSourceIds = new Set(
    [...coveredEvidenceReferences, ...quotedEvidence].map((reference) => reference.source_message_id),
  )
  const transcriptItems = transcriptEvidence(input.messages ?? [])
  const additionalTranscriptEvidence = transcriptItems
    .filter((item) => !coveredSourceIds.has(item.id))
    .map((item) => versionedForumReport
      ? { ...item, signalKey: "conversation_context", signalLabel: "Conversation context" }
      : item)
  const preliminaryTranscriptEvidence = versionedForumReport
    ? transcriptItems.map((item) => ({ ...item, signalKey: "conversation_context", signalLabel: "Conversation context" }))
    : additionalTranscriptEvidence
  const evidenceSummary = versionedForumReport
    ? preliminaryTranscriptEvidence.map((item) => `Transcript excerpt: ${item.excerpt}`).slice(0, MAX_ITEMS)
    : [
        ...coveredEvidenceSummary,
        ...additionalTranscriptEvidence.map((item) =>
          `${item.quality === "thin" ? "Context needing follow-up" : "Additional transcript evidence"}: ${item.excerpt}`,
        ),
      ].slice(0, MAX_ITEMS)
  const candidateReferences = [
    ...(versionedForumReport ? [] : [...coveredEvidenceReferences, ...quotedEvidence]),
    ...preliminaryTranscriptEvidence.map((item) => ({
      signal_key: item.signalKey,
      signal_label: item.signalLabel,
      source_message_id: item.id,
      excerpt: item.excerpt,
    })),
  ]
  const messageById = new Map((input.messages ?? [])
    .filter((message) => message.role === "user" && message.id)
    .map((message) => [message.id as string, message]))
  const mediaChoiceEvidence = mediaChoiceEvidenceByMessageId(input.messages ?? [])
  const referenceEvidence = referenceEvidenceByMessageId(input.messages ?? [])
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
      const referenceKey = `${messageId}:${reference.signal_key}`
      return [referenceKey, {
        ...reference,
        excerpt: quoteBySourceAndSignal.get(referenceKey) ??
          answer?.content.trim().slice(0, MAX_EVIDENCE_LENGTH) ?? reference.excerpt,
        ...(question ? { preceding_question: question } : {}),
        ...(mediaChoiceEvidence.get(messageId) || referenceEvidence.get(messageId)
          ? { interaction: mediaChoiceEvidence.get(messageId) ?? referenceEvidence.get(messageId) }
          : {}),
      }]
    })).values()].slice(0, MAX_ITEMS * 2)
  const askedKeys = new Set((input.messages ?? []).flatMap((message) => {
    if (message.role !== "assistant") return []
    const next = metadataRecord(metadataRecord(message.metadata)?.application_next_signal)
    return typeof next?.key === "string" ? [next.key] : []
  }))
  // A missed turn-level quote is not evidence that the full conversation lacks a signal.
  // The detailed V1 report reconciles all applicant turns before naming material gaps.
  const weakOrMissingSignals = (versionedForumReport ? [] : input.definitions.flatMap((signal) => {
    const answer = answerByKey.get(signal.key)
    if (answer && answer.covered !== false) return []
    return [
      input.insufficientEvidenceKeys?.has(signal.key) || askedKeys.has(signal.key) || Boolean(answer)
        ? `${signal.evidenceLabel}: insufficient evidence in this conversation.`
        : `${signal.evidenceLabel}: not explored in this conversation.`,
    ]
  })).slice(0, MAX_ITEMS)
  const usableCount = coveredEvidenceSummary.length
  const contextualCount = preliminaryTranscriptEvidence.length
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
      (versionedForumReport ? "Preliminary transcript snapshot; detailed evidence review is pending." : safeSuppliedBio) ||
      `Applicant shared ${usableCount} established evidence ${usableCount === 1 ? "area" : "areas"} and ${contextualCount} additional transcript ${contextualCount === 1 ? "statement" : "statements"} that may need reviewer context.`,
    advisory_recommendation: versionedForumReport
      ? "human_review"
      : recommendationForStatus(input.terminalStatus),
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
      (versionedForumReport ? "Complete the full-transcript evidence review before making a decision." : "") ||
      (!input.serverControlledFieldsOnly ? input.report?.reviewer_focus : "") ||
      (weakOrMissingSignals.length
        ? "Review the concrete evidence alongside the unresolved areas before making the community decision."
        : "Review whether the concrete evidence and proposed participation fit the Forum's needs."),
  }
}
