import type { GrouchoInteractionSpec } from "@/lib/gatekeeper-interaction-spec"
import type { ApplicationSignalDefinition } from "@/lib/application-signal-state"

const STRUCTURED_INPUT_TYPES = new Set([
  "singleSelect",
  "multiSelect",
  "ranking",
])

const CONTRIBUTION_ACTION =
  "contribute|bring|give|share|start|host|organise|organize|connect|introduce|write|post|reply|comment|recommend|listen|moderate|document|help|make|do|add|take part"

type ApplicationSignalDescriptor = Pick<ApplicationSignalDefinition, "label"> &
  Partial<Pick<ApplicationSignalDefinition, "goal">>

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[’]/g, "'")
}

function isConcreteContributionSignal(
  signal: ApplicationSignalDescriptor,
): boolean {
  const description = normalized(`${signal.label} ${signal.goal}`)
  return (
    description.includes("concrete") && description.includes("contribution")
  ) || description.includes("first month")
}

function signalDescription(
  signal: ApplicationSignalDescriptor,
): string {
  return normalized(`${signal.label} ${signal.goal ?? ""}`)
}

/**
 * A contribution target is only valid when the visible prompt asks the
 * applicant for an action. Community preferences and participation conditions
 * are useful evidence, but they are not the same question.
 */
export function applicationQuestionSupportsSignal(
  signal: ApplicationSignalDescriptor,
  question: string,
): boolean {
  const value = normalized(question)
  const description = signalDescription(signal)
  if (description.includes("what brought you here")) {
    return /\b(?:brought you|drew you|hoping to|community mean|reason for being here|looking for here)\b/.test(
      value,
    )
  }
  if (description.includes("relationship to colors")) {
    return /\b(?:colors|colours|this forum|the forum|this community|this particular (?:space|community)|here specifically|this door)\b/.test(
      value,
    )
  }
  if (description.includes("artist more people should know")) {
    return /\b(?:artist|creative|maker|musician|work)\b[^?]{0,100}\b(?:attention|know|miss|care about|deserves?)\b|\b(?:who\b[^?]{0,80}\b(?:making|artist|musician)|what do people\b[^?]{0,80}\bmiss\b[^?]{0,60}\bwork)\b/.test(
      value,
    )
  }
  if (description.includes("last song") && description.includes("recommend")) {
    return /\b(?:song|track|music|record|album)\b[^?]{0,100}\b(?:recommend|share|pass|send|hear)|\b(?:recommend|share|pass)\b[^?]{0,100}\b(?:song|track|music|record|album)\b/.test(
      value,
    )
  }
  if (description.includes("unfinished music")) {
    return /\b(?:feedback|respond|honest|honesty|unfinished|work (?:is|was) not|not naturally for you)\b/.test(
      value,
    )
  }
  if (description.includes("which sounds most like you")) {
    return /\b(?:which (?:of these )?sounds most like|how do you (?:usually )?participate|participate around music|music become social|relationship to music|joining? a conversation|what do you actually do around music|role do you .*around music|exchange with other artists or listeners|music scene around you|scene around you|part of the .*scene|inside the .*scene|adjacent to (?:it|the .*scene)|outside (?:it|the .*scene)|happening around music where you are)\b/.test(
      value,
    )
  }
  if (!isConcreteContributionSignal(signal)) return true
  const directActionQuestion = new RegExp(
    `\\b(?:what|how)\\b[^?]{0,100}\\b(?:would|could|will|can|might)\\s+you\\b[^?]{0,50}\\b(?:${CONTRIBUTION_ACTION})\\b`,
  )
  const contributionNounQuestion =
    /\bwhat\b[^?]{0,100}\b(?:contribution|participation)\b[^?]{0,80}\b(?:look like|in practice|first)\b/
  const existingReciprocityQuestion =
    /\b(?:what|which|how|when)\b[^?]{0,160}\b(?:give|giving|offer|contribut(?:e|ing)|share|help|host|connect|keep (?:doing|building))\b/
  return (
    directActionQuestion.test(value) ||
    contributionNounQuestion.test(value) ||
    existingReciprocityQuestion.test(value)
  )
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

/**
 * Stops a conditional preference ("I'd join if...") from being treated as a
 * concrete contribution. Other signal types remain model-assessed.
 */
export function applicationAnswerSupportsSignal(
  signal: ApplicationSignalDescriptor,
  answer: string,
): boolean {
  const description = signalDescription(signal)
  if (description.includes("artist more people should know")) {
    const raw = answer.trim()
    if (!raw) return false
    if (
      /^(?:i (?:do not|don't|cannot|can't) know|there are (?:loads|many)|any(?:one|thing)|whatever|someone|an? artist|the useful|the exchange|it depends|not sure)\b/i.test(
        raw,
      ) ||
      /^i (?:like|love|listen to) artists?\b/i.test(raw)
    ) {
      return false
    }
    return true
  }
  if (!isConcreteContributionSignal(signal)) return true
  const value = normalized(answer)
  if (!/\b(?:i|i'd|my)\b/.test(value)) return false
  if (/\bi(?:'d| would) take part if\b/.test(value)) return false
  const firstPersonAction = new RegExp(
    `\\b(?:i(?:'d| would| will| can| could| might| plan to| want to)|my contribution (?:would|will) be|would|will|can|could|might)\\s+(?:realistically\\s+)?(?:${CONTRIBUTION_ACTION})\\b`,
  )
  const existingFirstPersonAction = new RegExp(
    `\\bi\\s+(?:(?:already|usually|regularly|often|sometimes|keep|currently|still)\\s+|tend to\\s+)?(?:${CONTRIBUTION_ACTION})\\b`,
  )
  return firstPersonAction.test(value) || existingFirstPersonAction.test(value)
}

function hasExplicitResponsePrompt(reply: string): boolean {
  const value = reply.trim()
  if (!value) return false
  if (value.includes("?")) return true
  return /(?:^|[.!]\s+|\n)(?:choose|select|pick|tell me(?: which| about)?|describe|name|share|walk me through|take me into|say more|give me)\b/i.test(
    value,
  )
}

export type ActiveApplicationReplyIssue =
  | "terminal_language"
  | "missing_invitation"
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
    return "missing_invitation"
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
  signal: Pick<ApplicationSignalDefinition, "label" | "promptRoutes"> | null,
): string {
  if (signal?.label.trim().toLowerCase() === "which sounds most like you?") {
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
  nextSignal: Pick<ApplicationSignalDefinition, "label" | "promptRoutes"> | null
}): { reply: string; added: boolean } {
  if (!STRUCTURED_INPUT_TYPES.has(input.interaction.inputType)) {
    return { reply: input.reply, added: false }
  }

  const prompt = structuredPromptForSignal(input.nextSignal)
  if (hasExplicitResponsePrompt(input.reply)) {
    return input.nextSignal &&
      (!applicationQuestionSupportsSignal(input.nextSignal, input.reply) ||
        !/\b(?:which|choose|select|pick)\b/i.test(input.reply))
      ? { reply: prompt, added: true }
      : { reply: input.reply, added: false }
  }
  const reply = input.reply.trim()
  return {
    reply: reply ? `${reply}\n\n${prompt}` : prompt,
    added: true,
  }
}
