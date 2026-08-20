import {
  applicationSignalDefinitions,
  type ApplicationSignalAnswer,
  type ApplicationSignalDefinition,
  type ApplicationSignalMessage,
} from "@/lib/application-signal-state"
import type {
  GatekeeperTerminalField,
  GrouchoInteractionSpec,
} from "@/lib/gatekeeper-interaction-spec"
import type { Score } from "@/lib/scoring"
import type { ReviewerReport } from "@/lib/reviewer-report"
import type {
  ApplicationAnswerAssessment,
  ApplicationConversationMove,
} from "@/lib/application-conversation-depth"
import type { ApplicationResponseMode } from "@/lib/application-response-mode"
import { DEFAULT_APPLICATION_CLOSING_MESSAGE } from "@/lib/project-settings"
import { applicationQuestionBudget } from "@/lib/application-question-budget"

export type LocalGatekeeperTestTurn = {
  assistantContent: string
  structuredTerminal: GatekeeperTerminalField
  parsedNextSignalKey: string | null
  reviewerReport: ReviewerReport | null
  interactionSpec: GrouchoInteractionSpec
  scores: Score
  answerAssessment: ApplicationAnswerAssessment
  conversationMove: ApplicationConversationMove
  responseMode: ApplicationResponseMode
}

export const LOCAL_GATEKEEPER_TEST_SIGNALS: ApplicationSignalDefinition[] =
  applicationSignalDefinitions([
    "What brought you here?",
    "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
    "What's the last song you recommended, and why did you think it was worth sharing?",
    "Someone shares unfinished music that isn't really for you. How would you respond?",
    "Which sounds most like you?",
    "What's one thing you could realistically contribute in your first month?",
  ])

const MAX_ATTEMPTS_PER_SIGNAL = 3

const PARTICIPATION_OPTIONS = [
  "I mostly listen",
  "I like discussing music",
  "I enjoy giving feedback",
  "I regularly share discoveries",
]

const LOW_EVIDENCE_PATTERNS = [
  /\bidk\b/i,
  /\bi don't know\b/i,
  /\bnot sure\b/i,
  /\bn\/?a\b/i,
  /\bnothing\b/i,
  /\bno idea\b/i,
]

const EXTRACTIVE_PATTERNS = [
  /\b(access|exclusive|vip|network|networking|contacts)\b/i,
  /\b(followers|clout|status|promo|promote|promotion)\b/i,
  /\bmoneti[sz]e|brand activation|audience capture\b/i,
]

const STRONG_EVIDENCE_PATTERNS = [
  /\b(i|we)\b.+\b(started|made|built|hosted|organised|organized|ran|shared|recommended|introduced|curated|moderated|published|released|helped)\b/i,
  /\b(monthly|weekly|first month|feedback|listening|community|collaborat|context|artist|producer|release|session|forum)\b/i,
  /\b(because|so that|which led to|result|learned|noticed|care|trust)\b/i,
]

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function answerAttempts(answer: string): number {
  return Math.max(1, answer.split("\nFollow-up:").length)
}

function isLowEvidence(answer: string): boolean {
  const trimmed = answer.trim()
  return (
    trimmed.length < 24 ||
    LOW_EVIDENCE_PATTERNS.some((pattern) => pattern.test(trimmed))
  )
}

function answerStrength(answer: string): number {
  const trimmed = answer.trim()
  if (!trimmed) return 0.2
  if (isLowEvidence(trimmed)) return 0.25

  const lengthScore =
    trimmed.length >= 160 ? 0.24 : trimmed.length >= 80 ? 0.16 : 0.08
  const patternScore =
    STRONG_EVIDENCE_PATTERNS.filter((pattern) => pattern.test(trimmed)).length *
    0.12
  const extractivePenalty = EXTRACTIVE_PATTERNS.some((pattern) =>
    pattern.test(trimmed),
  )
    ? 0.25
    : 0

  return clamp(0.38 + lengthScore + patternScore - extractivePenalty)
}

function scoreAnswers(answers: ApplicationSignalAnswer[]): Score {
  if (!answers.length) {
    return {
      specificity: 0.45,
      authenticity: 0.45,
      cultural_depth: 0.45,
      overall: 0.45,
    }
  }

  const strengths = answers.map((answer) => answerStrength(answer.answer))
  const average =
    strengths.reduce((total, strength) => total + strength, 0) / strengths.length
  const lowEvidenceCount = answers.filter((answer) =>
    isLowEvidence(answer.answer),
  ).length
  const extractiveCount = answers.filter((answer) =>
    EXTRACTIVE_PATTERNS.some((pattern) => pattern.test(answer.answer)),
  ).length

  const specificity = clamp(average - lowEvidenceCount * 0.03)
  const authenticity = clamp(average - extractiveCount * 0.08)
  const culturalDepth = clamp(average - extractiveCount * 0.12)
  const overall = clamp((specificity + authenticity + culturalDepth) / 3)

  return {
    specificity,
    authenticity,
    cultural_depth: culturalDepth,
    overall,
  }
}

function assessAnswer(
  answer: ApplicationSignalAnswer | null,
): ApplicationAnswerAssessment {
  const value = answer?.answer.trim() ?? ""
  const isExtractive = EXTRACTIVE_PATTERNS.some((pattern) => pattern.test(value))
  const quality = isExtractive
    ? "concerning"
    : isLowEvidence(value)
      ? "thin"
      : answerStrength(value) >= 0.72
        ? "rich"
        : "usable"

  return {
    quality,
    reason:
      quality === "thin"
        ? "The local test fallback found limited usable evidence."
        : quality === "rich"
          ? "The local test fallback found concrete, particular evidence."
          : quality === "concerning"
            ? "The local test fallback found possible extractive framing."
            : "The local test fallback found enough evidence to continue.",
    evidence: {
      personalPointOfView: /\b(i|my|me)\b/i.test(value),
      concreteDetail: STRONG_EVIDENCE_PATTERNS.some((pattern) =>
        pattern.test(value),
      ),
      emotionalConnection: /\b(mean|felt|feel|love|moved|stays? with me)\b/i.test(
        value,
      ),
      independentJudgment: /\b(i think|i'd|i would|but|however|rather)\b/i.test(
        value,
      ),
      careOrContext: /\b(care|context|trust|consider|listen|feedback)\b/i.test(
        value,
      ),
    },
  }
}

function questionForSignal(signal: ApplicationSignalDefinition): string {
  if (signal.cluster === "colors_relationship") {
    return signal.promptRoutes[0] ?? "Why does COLORS feel like the right place for you?"
  }
  const label = signal.label.trim()
  if (label.endsWith("?")) return label
  return `Tell me about ${label.toLowerCase()}.`
}

function compactAnswer(answer: string): string {
  return answer.trim().replace(/\s+/g, " ").slice(0, 120)
}

function conversationalBridge(input: {
  answer: ApplicationSignalAnswer | null
  nextSignal: ApplicationSignalDefinition
}): string {
  const answer = compactAnswer(input.answer?.answer ?? "")
  if (!answer) return ""

  const lowerAnswer = answer.toLowerCase()
  const nextKey = input.nextSignal.key

  if (EXTRACTIVE_PATTERNS.some((pattern) => pattern.test(answer))) {
    return "That leans a little access-first. I need to see where the care is."
  }

  if (/\b(host|hosted|run|ran|organised|organized|started|built|curated)\b/i.test(answer)) {
    return "Okay. That sounds like you’ve actually made a space around music, not just hovered near one."
  }

  if (/\b(context|notice|listen|hearing|attention)\b/i.test(answer)) {
    return "That’s more useful — you’re talking about how people listen, not just what they should like."
  }

  if (/\b(feedback|unfinished|rough|demo|care|honest)\b/i.test(answer)) {
    return "There’s a bit of care in that. The unfinished-work answer matters more than people think."
  }

  if (/\b(recommended|shared|sent|played|introduced)\b/i.test(answer)) {
    return "That says something about how you move music between people."
  }

  if (nextKey === "participation_mode") {
    return "Good. Now I need to place you in the room."
  }

  if (nextKey === "first_month_contribution") {
    return "Fine. Let’s bring it down from taste to what you’d actually do here."
  }

  if (lowerAnswer.length > 80) {
    return "There’s enough there to keep going."
  }

  return "I hear the shape of that. I need the next layer."
}

function conversationalQuestion(input: {
  currentAnswer: ApplicationSignalAnswer | null
  nextSignal: ApplicationSignalDefinition
}): string {
  const question = questionForSignal(input.nextSignal)
  const bridge = conversationalBridge({
    answer: input.currentAnswer,
    nextSignal: input.nextSignal,
  })
  return bridge ? `${bridge}\n\n${question}` : question
}

function interactionForQuestion(
  signal: ApplicationSignalDefinition,
): GrouchoInteractionSpec {
  if (signal.label.trim().toLowerCase() === "which sounds most like you?") {
    return {
      intent: "probe",
      inputType: "singleSelect",
      options: PARTICIPATION_OPTIONS,
      emotionalState: "curious",
      visualState: "curious",
    }
  }
  return {
    intent: "probe",
    inputType: "text",
    emotionalState: "curious",
    visualState: "thinking",
  }
}

function terminalForScores(
  scores: Score,
  answers: ApplicationSignalAnswer[],
): GatekeeperTerminalField {
  const hasExtractiveSignal = answers.some((answer) =>
    EXTRACTIVE_PATTERNS.some((pattern) => pattern.test(answer.answer)),
  )
  if (hasExtractiveSignal && scores.overall < 0.58) return "reject"
  if (scores.overall >= 0.72) return "pass"
  return "redirect"
}

function reportForTerminal(input: {
  terminal: GatekeeperTerminalField
  scores: Score
  answers: ApplicationSignalAnswer[]
}): ReviewerReport {
  const evidence = input.answers
    .filter((answer) => !isLowEvidence(answer.answer))
    .slice(0, 4)
    .map((answer) => `${answer.label}: ${answer.answer}`)
  const weak = input.answers
    .filter((answer) => isLowEvidence(answer.answer))
    .slice(0, 4)
    .map((answer) => `${answer.label}: insufficient evidence`)
  const extractiveFlags = input.answers
    .filter((answer) =>
      EXTRACTIVE_PATTERNS.some((pattern) => pattern.test(answer.answer)),
    )
    .slice(0, 4)
    .map((answer) => `${answer.label}: possible access/promotion-first framing`)

  const advisory =
    input.terminal === "pass"
      ? "recommend"
      : input.terminal === "reject"
        ? "decline"
        : "human_review"

  return {
    applicant_bio:
      evidence.length > 0
        ? "Applicant completed the COLORS Forum test flow with evidence drawn from their answers. This local report is deterministic and intended for reviewer workflow testing only."
        : "Applicant completed the COLORS Forum test flow, but the local fallback found limited concrete evidence in their answers.",
    advisory_recommendation: advisory,
    confidence_score: clamp(
      input.scores.overall * (input.terminal === "redirect" ? 0.75 : 0.9),
    ),
    evidence_summary: evidence,
    evidence_references: input.answers.flatMap((answer) =>
      (answer.sources ?? []).map((source) => ({
        signal_key: answer.key,
        signal_label: answer.label,
        source_message_id: source.messageId,
        excerpt: source.excerpt,
      })),
    ),
    weak_or_missing_signals:
      weak.length > 0
        ? weak
        : ["No major weak signal detected by the local test fallback."],
    safety_or_integrity_flags: extractiveFlags,
    reviewer_focus:
      "Use this local fallback report to test the workflow only; review the full transcript and final COLORS rubric before making a client decision.",
  }
}

export function localGatekeeperTestModeEnabled(): boolean {
  return process.env.GROUPCHO_LOCAL_GATEKEEPER_TEST_MODE === "1"
}

export function localGatekeeperTestSignalDefinitions(
  configuredDefinitions: ApplicationSignalDefinition[],
): ApplicationSignalDefinition[] {
  return configuredDefinitions.length > 0
    ? configuredDefinitions
    : LOCAL_GATEKEEPER_TEST_SIGNALS
}

export function inferLocalGatekeeperAnswers(input: {
  definitions: ApplicationSignalDefinition[]
  messages: ApplicationSignalMessage[]
}): {
  answers: ApplicationSignalAnswer[]
  currentSignal: ApplicationSignalDefinition | null
} {
  const answers: ApplicationSignalAnswer[] = []
  const userMessages = input.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)

  userMessages.forEach((answer, index) => {
    const signal = input.definitions[Math.min(index, input.definitions.length - 1)]
    if (!signal) return
    answers.push({
      ...signal,
      answer,
    })
  })

  return {
    answers,
    currentSignal:
      answers.length > 0
        ? input.definitions[Math.min(answers.length - 1, input.definitions.length - 1)] ??
          null
        : input.definitions[0] ?? null,
  }
}

export function createLocalGatekeeperTestTurn(input: {
  definitions: ApplicationSignalDefinition[]
  answers: ApplicationSignalAnswer[]
  currentSignal: ApplicationSignalDefinition | null
  userAnswerCount: number
  maxTurns?: number
}): LocalGatekeeperTestTurn {
  const scores = scoreAnswers(input.answers)
  const answeredKeys = new Set(input.answers.map((answer) => answer.key))
  const currentAnswer = input.currentSignal
    ? input.answers.find((answer) => answer.key === input.currentSignal?.key)
      ?? null
    : null
  const currentAttempts = currentAnswer ? answerAttempts(currentAnswer.answer) : 1
  const answerAssessment = assessAnswer(currentAnswer)
  const questionBudget = applicationQuestionBudget({
    answeredQuestions: input.userAnswerCount,
    maxQuestions: input.maxTurns,
  })

  if (
    input.currentSignal &&
    currentAnswer &&
    isLowEvidence(currentAnswer.answer) &&
    currentAttempts < MAX_ATTEMPTS_PER_SIGNAL &&
    questionBudget.phase !== "emergency_stop"
  ) {
    return {
      assistantContent:
        "That’s still too abstract. Give me one concrete example — what did you actually do?",
      structuredTerminal: "none",
      parsedNextSignalKey: input.currentSignal.key,
      reviewerReport: null,
      interactionSpec: {
        intent: "clarify",
        inputType: "text",
        emotionalState: "skeptical",
        visualState: "thinking",
      },
      scores,
      answerAssessment,
      conversationMove: "clarify",
      responseMode: "probe",
    }
  }

  const nextSignal =
    input.definitions.find((signal) => !answeredKeys.has(signal.key)) ?? null
  const hasEnoughEarlyEvidence =
    input.answers.length >= 4 &&
    input.answers.filter((answer) => answerStrength(answer.answer) >= 0.72)
      .length >= 3

  if (
    nextSignal &&
    questionBudget.phase !== "emergency_stop" &&
    !hasEnoughEarlyEvidence
  ) {
    return {
      assistantContent: conversationalQuestion({
        currentAnswer,
        nextSignal,
      }),
      structuredTerminal: "none",
      parsedNextSignalKey: nextSignal.key,
      reviewerReport: null,
      interactionSpec: interactionForQuestion(nextSignal),
      scores,
      answerAssessment,
      conversationMove: "advance",
      responseMode: currentAnswer ? "connect" : "pivot",
    }
  }

  const terminal = terminalForScores(scores, input.answers)
  return {
    assistantContent: DEFAULT_APPLICATION_CLOSING_MESSAGE,
    structuredTerminal: terminal,
    parsedNextSignalKey: null,
    reviewerReport: reportForTerminal({
      terminal,
      scores,
      answers: input.answers,
    }),
    interactionSpec: {
      intent:
        terminal === "pass"
          ? "decide"
          : terminal === "reject"
            ? "reject"
            : "redirect",
      inputType: "text",
      emotionalState: "decisive",
      visualState: "decision",
    },
    scores,
    answerAssessment,
    conversationMove: "decide",
    responseMode: "close",
  }
}
