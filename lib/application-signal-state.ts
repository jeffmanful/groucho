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
}): string {
  const answersByKey = new Map(input.answers.map((answer) => [answer.key, answer]))
  const nextRequiredSignalKey =
    input.definitions.find((signal) => !answersByKey.has(signal.key))?.key ?? null
  const state = {
    signals: input.definitions.map((signal) => {
      const answer = answersByKey.get(signal.key)
      return {
        key: signal.key,
        label: signal.label,
        status: answer ? "answered" : "missing",
        ...(answer ? { answer: answer.answer } : {}),
      }
    }),
    current: {
      signalKey: input.currentSignal?.key ?? null,
      signalLabel: input.currentSignal?.label ?? null,
      question: input.currentQuestion,
      ...(!input.currentSignal ? { answer: input.currentAnswer } : {}),
    },
    nextRequiredSignalKey,
  }

  return `Review this compact application state and produce the next Groucho turn. Ask about nextRequiredSignalKey unless the current answer genuinely requires clarification. Do not skip ahead or ask for another answered signal. Set nextSignalKey to the signal your reply asks about, or an empty string on terminal turns.\n\n${JSON.stringify(state, null, 2)}`
}
