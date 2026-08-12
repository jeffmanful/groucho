export type ApplicationSignalDefinition = {
  key: string
  label: string
}

export type ApplicationSignalAnswer = ApplicationSignalDefinition & {
  answer: string
}

export type ApplicationSignalMessage = {
  role: "user" | "assistant"
  content: string
  metadata?: unknown
}

const MAX_SIGNAL_KEY_LENGTH = 48
const MAX_COMPACT_ANSWER_LENGTH = 600
const DEFAULT_MAX_QUESTIONS = 9
const DEFAULT_MAX_FOLLOWUPS_PER_SIGNAL = 2

const VAGUE_APPLICATION_PATTERNS = [
  /\bunderground culture\b/i,
  /\breal community\b/i,
  /\bauthentic\b/i,
  /\bthe scene\b/i,
  /\bvibes?\b/i,
  /\bpassionate\b/i,
  /\bi love music\b/i,
  /\bconnect with like[- ]minded\b/i,
]

const ACCESS_FIRST_PATTERNS = [
  /\baccess\b/i,
  /\bexclusive\b/i,
  /\bvip\b/i,
  /\bnetwork(?:ing)?\b/i,
  /\bexposure\b/i,
  /\bpromote|promotion|promo\b/i,
  /\bfollowers?\b/i,
  /\bclout\b/i,
]

const CONCRETE_ACTION_PATTERNS = [
  /\bhost(?:ed|ing)?\b/i,
  /\brun|ran|running\b/i,
  /\borganis(?:e|ed|ing)|organiz(?:e|ed|ing)\b/i,
  /\bcurat(?:e|ed|ing)\b/i,
  /\bintroduced?\b/i,
  /\bmoderated?\b/i,
  /\bpublished?\b/i,
  /\bwrote\b/i,
  /\bfeedback\b/i,
  /\bcollaborat(?:e|ed|ion)\b/i,
]

function signalKey(label: string, index: number): string {
  const normalized = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SIGNAL_KEY_LENGTH)
  return normalized || `signal_${index + 1}`
}

export function applicationSignalDefinitions(
  requiredSignals: string[] | undefined,
): ApplicationSignalDefinition[] {
  if (!requiredSignals?.length) return []
  const used = new Set<string>()
  return requiredSignals.map((label, index) => {
    const base = signalKey(label, index)
    let key = base
    let suffix = 2
    while (used.has(key)) {
      const suffixText = `_${suffix}`
      key = `${base.slice(0, MAX_SIGNAL_KEY_LENGTH - suffixText.length)}${suffixText}`
      suffix += 1
    }
    used.add(key)
    return { key, label }
  })
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }
  return metadata as Record<string, unknown>
}

function signalFromMetadata(
  metadata: unknown,
  field: "application_signal" | "application_next_signal",
  definitions: ApplicationSignalDefinition[],
): ApplicationSignalDefinition | null {
  const record = metadataRecord(metadata)
  const raw = record?.[field]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const key = (raw as Record<string, unknown>).key
  if (typeof key !== "string") return null
  return definitions.find((signal) => signal.key === key) ?? null
}

export function collectApplicationSignalAnswers(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
): ApplicationSignalAnswer[] {
  const answers = new Map<string, ApplicationSignalAnswer>()
  for (const message of messages) {
    if (message.role !== "user") continue
    const signal = signalFromMetadata(
      message.metadata,
      "application_signal",
      definitions,
    )
    if (!signal) continue
    const answer = message.content.trim()
    if (!answer) continue
    const previous = answers.get(signal.key)?.answer
    const combined = previous ? `${previous}\nFollow-up: ${answer}` : answer
    answers.set(signal.key, {
      ...signal,
      answer: combined.slice(0, MAX_COMPACT_ANSWER_LENGTH),
    })
  }
  return definitions.flatMap((signal) => {
    const answer = answers.get(signal.key)
    return answer ? [answer] : []
  })
}

export function hasLegacyUntaggedAnswers(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      signalFromMetadata(message.metadata, "application_signal", definitions) ===
        null,
  )
}

export function expectedApplicationSignal(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
  answers: ApplicationSignalAnswer[],
): ApplicationSignalDefinition | null {
  let requestedSignal: ApplicationSignalDefinition | null = null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    requestedSignal = signalFromMetadata(
      message.metadata,
      "application_next_signal",
      definitions,
    )
    break
  }
  if (requestedSignal) return requestedSignal
  const answered = new Set(answers.map((answer) => answer.key))
  return definitions.find((signal) => !answered.has(signal.key)) ?? null
}

export function withCurrentSignalAnswer(
  answers: ApplicationSignalAnswer[],
  signal: ApplicationSignalDefinition | null,
  currentAnswer: string,
): ApplicationSignalAnswer[] {
  if (!signal || !currentAnswer.trim()) return answers
  const next = answers.filter((answer) => answer.key !== signal.key)
  const previous = answers.find((answer) => answer.key === signal.key)?.answer
  const combined = previous
    ? `${previous}\nFollow-up: ${currentAnswer.trim()}`
    : currentAnswer.trim()
  next.push({ ...signal, answer: combined.slice(0, MAX_COMPACT_ANSWER_LENGTH) })
  return next
}

export function applicationSignalAnswerAttemptCount(
  answer: ApplicationSignalAnswer | undefined,
): number {
  if (!answer?.answer.trim()) return 0
  return answer.answer.split("\nFollow-up:").length
}

function latestAnswer(answer: ApplicationSignalAnswer | undefined): string {
  if (!answer?.answer.trim()) return ""
  return answer.answer.split("\nFollow-up:").at(-1)?.trim() ?? answer.answer.trim()
}

function hasConcreteAction(answer: string): boolean {
  return CONCRETE_ACTION_PATTERNS.some((pattern) => pattern.test(answer))
}

function investigationDirective(input: {
  currentSignal: ApplicationSignalDefinition | null
  answer: ApplicationSignalAnswer | undefined
  remainingQuestions: number
  followupsRemaining: number
}):
  | {
      shouldInvestigate: true
      reason: string
      recommendedNextSignalKey: string
      suggestedFollowups: string[]
    }
  | {
      shouldInvestigate: false
      reason: string
    } {
  const answer = latestAnswer(input.answer)
  if (
    !input.currentSignal ||
    !answer ||
    input.remainingQuestions <= 0 ||
    input.followupsRemaining <= 0
  ) {
    return {
      shouldInvestigate: false,
      reason: "No current answer or no follow-up budget remains.",
    }
  }

  const isAccessFirst = ACCESS_FIRST_PATTERNS.some((pattern) =>
    pattern.test(answer),
  )
  if (isAccessFirst) {
    return {
      shouldInvestigate: true,
      reason: "Current answer may be access-, exposure-, or status-first.",
      recommendedNextSignalKey: input.currentSignal.key,
      suggestedFollowups: [
        "What would you give to the room besides access or attention?",
        "Who would need to be considered before you brought that energy into the Forum?",
      ],
    }
  }

  const isVague =
    answer.length < 90 ||
    VAGUE_APPLICATION_PATTERNS.some((pattern) => pattern.test(answer))
  if (isVague && !hasConcreteAction(answer)) {
    return {
      shouldInvestigate: true,
      reason:
        "Current answer is values-language or atmosphere-language without a behavioural example.",
      recommendedNextSignalKey: input.currentSignal.key,
      suggestedFollowups: [
        "What does that look like in practice?",
        "Give me one concrete example. What did you actually do?",
      ],
    }
  }

  const isInteresting =
    answer.length >= 90 &&
    hasConcreteAction(answer) &&
    /\b(because|so|led to|changed|learned|noticed|care|trust|context)\b/i.test(
      answer,
    )
  if (isInteresting) {
    return {
      shouldInvestigate: true,
      reason:
        "Current answer has a concrete thread worth pressure-testing for role, consequence, or care.",
      recommendedNextSignalKey: input.currentSignal.key,
      suggestedFollowups: [
        "What changed because of that?",
        "What was your actual role in making that happen?",
      ],
    }
  }

  return {
    shouldInvestigate: false,
    reason: "Current answer has enough usable evidence to advance.",
  }
}

export function resolveNextApplicationSignal(
  requestedKey: string | null,
  definitions: ApplicationSignalDefinition[],
  answers: ApplicationSignalAnswer[],
  currentSignal: ApplicationSignalDefinition | null,
): ApplicationSignalDefinition | null {
  const answered = new Set(answers.map((answer) => answer.key))
  const nextMissing = definitions.find((signal) => !answered.has(signal.key)) ?? null
  if (requestedKey) {
    const requested = definitions.find((signal) => signal.key === requestedKey)
    if (
      requested &&
      (requested.key === currentSignal?.key || requested.key === nextMissing?.key)
    ) {
      return requested
    }
  }
  return nextMissing ?? currentSignal ?? null
}

export function applicationSignalMetadata(
  signal: ApplicationSignalDefinition | null,
): Record<string, string> | undefined {
  return signal ? { key: signal.key, label: signal.label } : undefined
}

export function buildCompactApplicationStateMessage(input: {
  definitions: ApplicationSignalDefinition[]
  answers: ApplicationSignalAnswer[]
  currentSignal: ApplicationSignalDefinition | null
  currentQuestion: string
  currentAnswer: string
  answeredQuestionCount?: number
  maxQuestions?: number
  maxFollowupsPerSignal?: number
}): string {
  const answersByKey = new Map(input.answers.map((answer) => [answer.key, answer]))
  const nextRequiredSignalKey =
    input.definitions.find((signal) => !answersByKey.has(signal.key))?.key ?? null
  const maxQuestions = input.maxQuestions ?? DEFAULT_MAX_QUESTIONS
  const maxFollowupsPerSignal =
    input.maxFollowupsPerSignal ?? DEFAULT_MAX_FOLLOWUPS_PER_SIGNAL
  const answeredQuestionCount =
    input.answeredQuestionCount ??
    input.answers.reduce(
      (total, answer) => total + applicationSignalAnswerAttemptCount(answer),
      0,
    )
  const state = {
    questionBudget: {
      maxQuestions,
      answeredQuestions: answeredQuestionCount,
      remainingQuestions: Math.max(0, maxQuestions - answeredQuestionCount),
      maxFollowupsPerSignal,
    },
    signals: input.definitions.map((signal) => {
      const answer = answersByKey.get(signal.key)
      const attempts = applicationSignalAnswerAttemptCount(answer)
      const followupCount = Math.max(0, attempts - 1)
      return {
        key: signal.key,
        label: signal.label,
        status: answer ? "answered" : "missing",
        attempts,
        followupCount,
        followupsRemaining: Math.max(
          0,
          maxFollowupsPerSignal - followupCount,
        ),
        ...(answer ? { answer: answer.answer } : {}),
      }
    }),
    current: {
      signalKey: input.currentSignal?.key ?? null,
      signalLabel: input.currentSignal?.label ?? null,
      question: input.currentQuestion,
      answer: input.currentAnswer,
      ...(input.currentSignal
        ? (() => {
            const currentAnswer = answersByKey.get(input.currentSignal.key)
            const attempts = applicationSignalAnswerAttemptCount(currentAnswer)
            const followupCount = Math.max(0, attempts - 1)
            const followupsRemaining = Math.max(
              0,
              maxFollowupsPerSignal - followupCount,
            )
            return {
              attempts,
              followupCount,
              followupsRemaining,
              investigationDirective: investigationDirective({
                currentSignal: input.currentSignal,
                answer: currentAnswer,
                remainingQuestions: Math.max(
                  0,
                  maxQuestions - answeredQuestionCount,
                ),
                followupsRemaining,
              }),
            }
          })()
        : {}),
    },
    nextRequiredSignalKey,
  }

  return `Review this compact application state and produce the next Groucho turn.

First decide whether the current answer needs doorman investigation. If current.investigationDirective.shouldInvestigate is true, follow it: stay on current.signalKey, ask one of the suggested follow-up styles or a sharper equivalent, and set nextSignalKey to current.investigationDirective.recommendedNextSignalKey. Do not advance to nextRequiredSignalKey on that turn.

If current.investigationDirective.shouldInvestigate is false, independently check whether investigation is still warranted. If it is and the current signal has followupsRemaining > 0, stay on current.signalKey instead of advancing. Do not treat this as optional.

Use doorman investigation for:
- vague or polished answers with no behavioural example;
- evasive, contradictory, extractive, access-first, or status-first framing;
- interesting concrete details where one sharper follow-up would reveal role, care, consequence, or contribution.

Only advance to nextRequiredSignalKey when the current answer has usable evidence, when followupsRemaining is 0, or when the remaining question budget is too low to investigate.

Follow-up limits:
- Ask at most questionBudget.maxFollowupsPerSignal follow-ups for any one signal.
- Never exceed questionBudget.maxQuestions total applicant-facing questions.
- If followupsRemaining is 0 for the current signal and evidence is still thin, record that weakness privately and move on or conclude.

Keep the exchange conversational: acknowledge one concrete detail, tension, or gap from the current answer before asking. Avoid generic praise and do not sound like a form. Do not ask who received, was sent, or was recommended music. Set nextSignalKey to the signal your reply asks about, or an empty string on terminal turns.\n\n${JSON.stringify(state, null, 2)}`
}
