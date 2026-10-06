import {
  normaliseMediaChoiceAnswer,
  normaliseMediaChoiceInteraction,
  type MediaChoiceMode,
} from "@/lib/gatekeeper-interaction-spec"

export const APPLICATION_PROCESS_FEEDBACK_KINDS = [
  "none",
  "corrects_assistant_assumption",
  "requests_topic_change",
] as const

export type ApplicationProcessFeedbackKind =
  (typeof APPLICATION_PROCESS_FEEDBACK_KINDS)[number]

export type ApplicationProcessFeedback = {
  kind: Exclude<ApplicationProcessFeedbackKind, "none"> | "clarification_request"
  sourceMessageId: string
}

export const APPLICATION_MEDIA_CLAIM_KINDS = [
  "none",
  "not_yet_listened_closely",
  "provisional_choice",
] as const

export type ApplicationMediaClaimKind =
  (typeof APPLICATION_MEDIA_CLAIM_KINDS)[number]

export type ApplicationMediaClaim = {
  kind: Exclude<ApplicationMediaClaimKind, "none">
  sourceMessageId: string
  quote: string
}

export type ApplicationFacts = {
  version: 1
  mediaChoice: {
    questionId: string
    sourceMessageId: string
    mode: MediaChoiceMode
    selectedOptionIds: string[]
    retainedOptionIds: string[]
    explicitOrderOptionIds: string[] | null
    depthFollowupUsed: boolean
    applicantClaims: ApplicationMediaClaim[]
  } | null
  processFeedback: ApplicationProcessFeedback[]
}

export type ApplicationFactMessage = {
  id?: string
  role: "user" | "assistant"
  content: string
  metadata?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function normaliseProcessFeedbackKind(raw: unknown): ApplicationProcessFeedbackKind {
  return raw === "corrects_assistant_assumption" || raw === "requests_topic_change"
    ? raw
    : "none"
}

export function normaliseMediaClaim(raw: unknown, currentAnswer: string): {
  kind: ApplicationMediaClaimKind
  quote: string
} {
  const value = record(raw)
  const kind = value?.kind
  const quote = typeof value?.quote === "string" ? value.quote.trim() : ""
  if (
    (kind === "not_yet_listened_closely" || kind === "provisional_choice") &&
    quote.length >= 8 &&
    currentAnswer.includes(quote)
  ) {
    return { kind, quote: quote.slice(0, 240) }
  }
  return { kind: "none", quote: "" }
}

export function collectApplicationFacts(messages: ApplicationFactMessage[]): ApplicationFacts {
  const facts: ApplicationFacts = {
    version: 1,
    mediaChoice: null,
    processFeedback: [],
  }
  let activeMediaQuestion: ReturnType<typeof normaliseMediaChoiceInteraction>
  for (const message of messages) {
    const metadata = record(message.metadata)
    if (message.role === "assistant") {
      const ui = record(metadata?.ui)
      const interaction = normaliseMediaChoiceInteraction(ui?.mediaChoice)
      if (interaction) activeMediaQuestion = interaction
      if (facts.mediaChoice && metadata?.application_media_depth_followup === true) {
        facts.mediaChoice.depthFollowupUsed = true
      }
      continue
    }
    if (!message.id) continue
    const relation = record(metadata?.application_answer_relation)
    const feedback = record(metadata?.application_process_feedback)
    const feedbackKind = relation?.kind === "clarification_request"
      ? "clarification_request"
      : normaliseProcessFeedbackKind(feedback?.kind)
    if (feedbackKind !== "none") {
      facts.processFeedback.push({ kind: feedbackKind, sourceMessageId: message.id })
    }

    const answer = normaliseMediaChoiceAnswer(metadata?.interaction_answer)
    if (answer && activeMediaQuestion?.id === answer.questionId &&
      activeMediaQuestion.selection.mode === answer.mode) {
      const allIds = activeMediaQuestion.options.map((option) => option.id)
      const selectedOptionIds = answer.optionIds.filter((id) => allIds.includes(id))
      const retainedOptionIds = answer.mode === "remove"
        ? allIds.filter((id) => !selectedOptionIds.includes(id))
        : selectedOptionIds
      facts.mediaChoice = {
        questionId: answer.questionId,
        sourceMessageId: message.id,
        mode: answer.mode,
        selectedOptionIds,
        retainedOptionIds,
        explicitOrderOptionIds: answer.mode === "rank" ? selectedOptionIds : null,
        depthFollowupUsed: false,
        applicantClaims: [],
      }
    }
    const claim = record(metadata?.application_media_claim)
    if (facts.mediaChoice && claim &&
      (claim.kind === "not_yet_listened_closely" || claim.kind === "provisional_choice") &&
      claim.sourceMessageId === message.id &&
      typeof claim.quote === "string" && message.content.includes(claim.quote)) {
      facts.mediaChoice.applicantClaims.push({
        kind: claim.kind,
        sourceMessageId: message.id,
        quote: claim.quote.slice(0, 240),
      })
    }
  }
  return facts
}

export function isApplicationProcessFeedback(metadata: unknown): boolean {
  const value = record(metadata)
  return record(value?.application_answer_relation)?.kind === "clarification_request" ||
    normaliseProcessFeedbackKind(record(value?.application_process_feedback)?.kind) !== "none"
}
