import type { GrouchoInteractionSpec } from "@/lib/gatekeeper-interaction-spec"
import type { ApplicationSignalDefinition } from "@/lib/application-signal-state"

const STRUCTURED_INPUT_TYPES = new Set([
  "singleSelect",
  "multiSelect",
  "ranking",
])

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[’]/g, "'")
}

const RECEIPT_STOP_WORDS = new Set([
  "about", "after", "again", "because", "before", "could", "from", "have",
  "into", "just", "more", "that", "their", "there", "these", "they", "this",
  "what", "when", "where", "which", "with", "would", "your", "you're",
])

function meaningfulWords(value: string): Set<string> {
  return new Set(
    normalized(value)
      .split(/[^a-z0-9']+/)
      .filter((word) => word.length >= 4 && !RECEIPT_STOP_WORDS.has(word)),
  )
}

/** Keeps one grounded declarative receipt when a controller must replace the question. */
export function repairApplicationReplyWithQuestion(input: {
  reply: string
  currentAnswer: string
  question: string
}): { reply: string; receiptPreserved: boolean } {
  const answerWords = meaningfulWords(input.currentAnswer)
  const sentences = input.reply.trim().split(/(?<=[.!?])\s+/)
  const receipt = sentences.find((sentence) => {
    const value = sentence.trim()
    if (!value || value.includes("?")) return false
    if (/^(?:good|got it|thanks|thank you|interesting|that matters)[.!—,\s]*$/i.test(value)) {
      return false
    }
    return [...meaningfulWords(value)].some((word) => answerWords.has(word))
  })
  return {
    reply: receipt ? `${receipt.trim()} ${input.question}` : input.question,
    receiptPreserved: Boolean(receipt),
  }
}

function hasExplicitResponsePrompt(reply: string): boolean {
  const value = reply.trim()
  if (!value) return false
  const questions = value
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => sentence.includes("?"))
  if (questions.some((question) => {
    const clause = (question.split(/[,—–:]\s*(?=(?:what|how|why|where|when|who|which|is|are|was|were|do|does|did|can|could|would|will|should|have|has)\b)/i).at(-1) ?? question).trim()
    if (/^what (?:strikes|stands out to|i (?:hear|notice|see|think|find))\b/i.test(clause)) {
      return false
    }
    return /^(?:what|how|why|where|when|who|which|whose|is|are|was|were|do|does|did|can|could|would|will|should|have|has)\b/i.test(clause)
  })) {
    return true
  }
  if (/\b(?:i(?:'m| am) curious|i wonder)\s+(?:what|how|whether|which|who|where|when)\b/i.test(value)) {
    return true
  }
  return /(?:^|[.!]\s+|\n)(?:choose|select|pick|tell me(?: which| about)?|describe|name|share|walk me through|take me into|say more|give me)\b/i.test(
    value,
  )
}

export type ActiveApplicationReplyIssue =
  | "terminal_language"
  | "missing_invitation"
  | "unclear_invitation"
  | "missing_artist_antecedent"
  | "multiple_questions"
  | "repeated_question"

export function keepFirstApplicationQuestion(reply: string): string {
  const firstQuestionEnd = reply.indexOf("?")
  const firstQuestion =
    firstQuestionEnd >= 0 ? reply.slice(0, firstQuestionEnd + 1) : reply
  const stackedAsk = firstQuestion.search(
    /,?\s+(?:and|plus)\s+(?=(?:what|how|where|when|who|which)\b)/i,
  )
  if (stackedAsk >= 0) {
    return `${firstQuestion.slice(0, stackedAsk).trim().replace(/[.!?]+$/, "")}?`
  }
  return firstQuestion.trim()
}

function normalizedQuestions(value: string): string[] {
  return (value.match(/[^?]+\?/g) ?? []).flatMap((question) => {
    const result = normalized(question.split(/(?<=[.!])\s+|\n+/).at(-1) ?? question)
      .replace(/\bwhat's\b/g, "what is")
      .replace(/[*_`]/g, "")
      .replace(/[^a-z0-9']+/g, " ")
      .trim()
    return result.split(/\s+/).length >= 5 ? [result] : []
  })
}

function containsTerminalApplicationLanguage(
  reply: string,
  closingMessage: string,
): boolean {
  const value = normalized(reply)
  const configuredClosing = normalized(closingMessage)
  if (configuredClosing && value.includes(configuredClosing)) return true
  return /\b(?:we(?:'ll| will) get in touch|your application (?:is|has been) (?:complete|completed|received)|we have everything we need|that's all (?:i|we) need)\b/.test(
    value,
  )
}

/**
 * Active application turns must visibly leave the conversation open. A model
 * can otherwise return terminal copy with `terminal: none`, or a reflection
 * that gives the applicant no way to continue.
 */
export function activeApplicationReplyIssue(input: {
  reply: string
  interaction: GrouchoInteractionSpec
  closingMessage: string
  previousQuestion?: string
  hasArtistAntecedent?: boolean
}): ActiveApplicationReplyIssue | null {
  if (
    containsTerminalApplicationLanguage(input.reply, input.closingMessage)
  ) {
    return "terminal_language"
  }
  if (
    input.hasArtistAntecedent === false &&
    /\b(?:one|which) of their (?:songs?|tracks?|pieces?|records?)\b/i.test(
      input.reply,
    )
  ) {
    return "missing_artist_antecedent"
  }
  if (
    (input.interaction.inputType === "text" ||
      input.interaction.inputType === "voice") &&
    !hasExplicitResponsePrompt(input.reply)
  ) {
    return input.reply.includes("?") ? "unclear_invitation" : "missing_invitation"
  }
  if (
    normalizedQuestions(input.reply).length > 1 ||
    /\b(?:what|how|why|where|when|who|which)\b[^?]{0,180},?\s+(?:and|plus)\s+(?:what|how|where|when|who|which)\b/i.test(
      input.reply,
    )
  ) {
    return "multiple_questions"
  }
  const previousQuestions = normalizedQuestions(input.previousQuestion ?? "")
  const replyQuestions = new Set(normalizedQuestions(input.reply))
  if (previousQuestions.some((question) => replyQuestions.has(question))) {
    return "repeated_question"
  }
  return null
}

function structuredPromptForSignal(
  signal: Pick<ApplicationSignalDefinition, "kind" | "label" | "promptRoutes"> | null,
): string {
  if (signal?.kind === "participation") {
    return "Which of these sounds most like how you participate around music?"
  }
  const route = signal?.promptRoutes?.find((candidate) => candidate.includes("?"))
  if (route) return route.trim()
  if (signal?.label.trim()) {
    const label = signal.label.trim()
    return label.endsWith("?") ? label : `${label}?`
  }
  return "Which option best fits your answer?"
}

export function ensureExplicitStructuredInputPrompt(input: {
  reply: string
  interaction: GrouchoInteractionSpec
  nextSignal: Pick<ApplicationSignalDefinition, "kind" | "label" | "promptRoutes"> | null
}): {
  reply: string
  interaction: GrouchoInteractionSpec
  added: boolean
  downgradedToText: boolean
} {
  if (!STRUCTURED_INPUT_TYPES.has(input.interaction.inputType)) {
    return {
      reply: input.reply,
      interaction: input.interaction,
      added: false,
      downgradedToText: false,
    }
  }

  const prompt = structuredPromptForSignal(input.nextSignal)
  if (hasExplicitResponsePrompt(input.reply)) {
    if (!/\b(?:which|choose|select|pick)\b/i.test(input.reply)) {
      const textInteraction = { ...input.interaction }
      delete textInteraction.options
      return {
        reply: input.reply,
        interaction: { ...textInteraction, inputType: "text" },
        added: false,
        downgradedToText: true,
      }
    }
    return {
      reply: input.reply,
      interaction: input.interaction,
      added: false,
      downgradedToText: false,
    }
  }
  const reply = input.reply.trim()
  return {
    reply: reply ? `${reply}\n\n${prompt}` : prompt,
    interaction: input.interaction,
    added: true,
    downgradedToText: false,
  }
}
