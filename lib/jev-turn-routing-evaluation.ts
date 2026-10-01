import type {
  JevTurnAction,
  JevTurnQuality,
  JevTurnRelation,
  JevTurnRisk,
  JevTurnRoutingCase,
  JevTurnSignal,
} from "@/evals/jev-turn-routing-cases"
import {
  evaluateJevSystemOne,
  type JevAnswer,
  type JevChoiceAnswer,
  type JevQuestion,
  type JevSystemOneResponse,
} from "@/lib/jev-shadow-evaluation"

const COVERAGE_PREFIX = "coverage__"

export type JevTurnRoutingState = {
  currentQuestion: string
  currentAnswer: string
  currentSignalKey: string
  priorCoveredSignalKeys: readonly string[]
  allowClose: boolean
  signals: readonly JevTurnSignal[]
}

export type JevTurnRoutingReadout = {
  relation: JevTurnRelation
  quality: JevTurnQuality
  coveredSignalKeys: string[]
  coverageProbabilities: Record<string, number>
  action: JevTurnAction
  nextSignalKey: string | null
  fastClose: boolean
  risk: JevTurnRisk
  riskProbabilities: {
    fabrication: number
    extractive_intent: number
    consent_violation: number
  }
}

function choiceQuestion(
  instructions: string,
  criteria: Record<string, string>,
): JevQuestion {
  return { type: "choice", instructions, criteria }
}

function noulQuestion(
  instructions: string,
  yes: string,
  no: string,
): JevQuestion {
  return {
    type: "noul",
    instructions,
    criteria: { true: yes, false: no },
  }
}

export function buildJevTurnRoutingQuestions(
  state: JevTurnRoutingState,
): Record<string, JevQuestion> {
  const priorCovered = new Set(state.priorCoveredSignalKeys)
  const openSignals = state.signals.filter((signal) => !priorCovered.has(signal.key))
  const nextSignalCriteria = Object.fromEntries([
    [
      "none",
      "No next evidence goal: use for a close, an ambiguous or subject-shift repair, or when no listed goal is appropriate.",
    ],
    ...openSignals.map((signal) => [
      signal.key,
      `${signal.label}: ${signal.goal}${
        signal.key === state.currentSignalKey ? " This is the current evidence goal." : ""
      }`,
    ]),
  ])

  const questions: Record<string, JevQuestion> = {
    answer_relation: choiceQuestion(
      "How does `currentAnswer` relate to `currentQuestion`? Judge relation separately from answer quality.",
      {
        direct: "It answers the question that was asked.",
        partial: "It answers only one part or leaves an explicitly requested part unresolved.",
        subject_shift: "It introduces a different subject without explaining its connection to the question.",
        ambiguous: "Its intended connection to the question cannot yet be determined.",
      },
    ),
    answer_quality: choiceQuestion(
      "How useful is `currentAnswer` as application evidence? Judge substance, not length, fluency, fame, credentials, or status.",
      {
        thin: "Empty, generic, evasive, or too vague to establish usable evidence.",
        usable: "Relevant evidence with at least one concrete fact, intention, behavior, or judgment.",
        rich: "Multiple concrete details or a well-developed personal judgment that may support more than one evidence goal.",
        concerning: "Explicitly reveals fabrication, repeated extractive intent, disregard for consent, or another clear integrity concern.",
      },
    ),
    next_action: choiceQuestion(
      "Choose the smallest valid controller action after `currentAnswer`. Respect `allowClose`, `priorCoveredSignalKeys`, the supplied `signals`, and explicit integrity concerns.",
      {
        clarify: "The answer is thin, ambiguous, or a subject shift and needs one short repair or clarification.",
        follow_thread: "The answer is useful but a natural follow-up on the current evidence goal would resolve an important missing part.",
        advance: "The current goal has enough evidence and another open goal should be pursued.",
        challenge: "An explicit integrity or consent concern should be addressed before proceeding or closing.",
        close: "Closing is allowed, every supplied evidence goal is covered after this answer, and no integrity concern needs a challenge.",
      },
    ),
    next_signal: choiceQuestion(
      "Which supplied open evidence goal should the controller target next? Choose `none` for a close or for a repair that should not claim a goal yet.",
      nextSignalCriteria,
    ),
    admitted_fabrication: noulQuestion(
      "Does `currentAnswer` explicitly admit inventing or materially misrepresenting a participation claim to improve the applicant's chances?",
      "There is an explicit admission of fabrication or material misrepresentation.",
      "There is no explicit admission; uncertainty or correction without deception is not fabrication.",
    ),
    repeated_extractive_intent: noulQuestion(
      "Does `currentAnswer` explicitly frame the community mainly as access to people, work, or attention for the applicant's platform, without reciprocal intent?",
      "Primarily extractive intent is explicit in the answer.",
      "Reciprocal intent is present, or extractive intent is not explicit.",
    ),
    consent_violation: noulQuestion(
      "Does `currentAnswer` explicitly say the applicant shares private creative work without permission and would continue after the creator objects?",
      "Both non-consensual sharing and intent to continue after objection are explicit.",
      "Either condition is absent or unclear.",
    ),
  }

  for (const signal of openSignals) {
    questions[`${COVERAGE_PREFIX}${signal.key}`] = noulQuestion(
      `Does \`currentAnswer\` explicitly provide usable evidence for this goal: ${signal.goal}`,
      "The answer explicitly supplies concrete evidence for this goal, whether positive or concerning.",
      "The answer does not supply usable evidence for this goal; thematic similarity alone is insufficient.",
    )
  }
  return questions
}

export function turnRoutingState(
  calibrationCase: JevTurnRoutingCase,
  signals: readonly JevTurnSignal[],
): JevTurnRoutingState {
  return {
    currentQuestion: calibrationCase.currentQuestion,
    currentAnswer: calibrationCase.currentAnswer,
    currentSignalKey: calibrationCase.currentSignalKey,
    priorCoveredSignalKeys: calibrationCase.priorCoveredSignalKeys,
    allowClose: calibrationCase.allowClose,
    signals,
  }
}

function probability(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid Jev probability for ${label}`)
  }
  return value
}

function choice(
  answers: Record<string, JevAnswer>,
  key: string,
  allowed: readonly string[],
): JevChoiceAnswer {
  const answer = answers[key]
  if (!answer || answer.type !== "choice" || !allowed.includes(answer.choice)) {
    throw new Error(`Missing or invalid Jev choice answer: ${key}`)
  }
  probability(answer.confidence, `${key}.confidence`)
  return answer
}

function noul(answers: Record<string, JevAnswer>, key: string): number {
  const answer = answers[key]
  if (!answer || answer.type !== "noul") {
    throw new Error(`Missing Jev noul answer: ${key}`)
  }
  return probability(answer.noul, key)
}

export function interpretJevTurnRoutingResponse(input: {
  response: JevSystemOneResponse
  state: JevTurnRoutingState
  coverageThreshold?: number
  riskThreshold?: number
}): JevTurnRoutingReadout {
  const coverageThreshold = input.coverageThreshold ?? 0.5
  const riskThreshold = input.riskThreshold ?? 0.75
  const answers = input.response.answers
  const relation = choice(answers, "answer_relation", [
    "direct",
    "partial",
    "subject_shift",
    "ambiguous",
  ]).choice as JevTurnRelation
  const quality = choice(answers, "answer_quality", [
    "thin",
    "usable",
    "rich",
    "concerning",
  ]).choice as JevTurnQuality
  const action = choice(answers, "next_action", [
    "clarify",
    "follow_thread",
    "advance",
    "challenge",
    "close",
  ]).choice as JevTurnAction
  const openSignalKeys = input.state.signals
    .filter((signal) => !input.state.priorCoveredSignalKeys.includes(signal.key))
    .map((signal) => signal.key)
  const nextSignalChoice = choice(answers, "next_signal", ["none", ...openSignalKeys]).choice
  const nextSignalKey = nextSignalChoice === "none" ? null : nextSignalChoice
  const coverageProbabilities = Object.fromEntries(
    openSignalKeys.map((key) => [key, noul(answers, `${COVERAGE_PREFIX}${key}`)]),
  )
  const coveredSignalKeys = openSignalKeys.filter(
    (key) => coverageProbabilities[key] >= coverageThreshold,
  )
  const riskProbabilities = {
    fabrication: noul(answers, "admitted_fabrication"),
    extractive_intent: noul(answers, "repeated_extractive_intent"),
    consent_violation: noul(answers, "consent_violation"),
  }
  const risk: JevTurnRisk =
    riskProbabilities.consent_violation >= riskThreshold
      ? "consent_violation"
      : riskProbabilities.fabrication >= riskThreshold
        ? "fabrication"
        : riskProbabilities.extractive_intent >= riskThreshold
          ? "extractive_intent"
          : "none"
  const coveredAfter = new Set([
    ...input.state.priorCoveredSignalKeys,
    ...coveredSignalKeys,
  ])
  const fastClose =
    input.state.allowClose &&
    risk === "none" &&
    relation === "direct" &&
    (quality === "usable" || quality === "rich") &&
    input.state.signals.every((signal) => coveredAfter.has(signal.key))

  return {
    relation,
    quality,
    coveredSignalKeys,
    coverageProbabilities,
    action,
    nextSignalKey,
    fastClose,
    risk,
    riskProbabilities,
  }
}

export async function evaluateJevTurnRouting(input: {
  apiKey: string
  state: JevTurnRoutingState
  endpoint: string
  model: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}) {
  return evaluateJevSystemOne({
    ...input,
    questions: buildJevTurnRoutingQuestions(input.state),
  })
}

