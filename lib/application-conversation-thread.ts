import type { ApplicationAnswerAssessment } from "@/lib/application-conversation-depth"

export const CONVERSATION_THREAD_MOMENTUM = [
  "new",
  "high",
  "medium",
  "low",
  "exhausted",
] as const

export const APPLICANT_CONVERSATION_ENERGY = [
  "neutral",
  "guarded",
  "engaged",
  "playful",
  "thoughtful",
  "uncertain",
] as const

export type ConversationThreadMomentum =
  (typeof CONVERSATION_THREAD_MOMENTUM)[number]
export type ApplicantConversationEnergy =
  (typeof APPLICANT_CONVERSATION_ENERGY)[number]

export type ApplicationConversationThread = {
  subject: string | null
  strongestDetail: string | null
  openHook: string | null
  momentum: ConversationThreadMomentum
  applicantEnergy: ApplicantConversationEnergy
  acknowledgedDetails: string[]
}

export type ConversationThreadMessage = {
  role: "user" | "assistant"
  metadata?: unknown
}

export const EMPTY_APPLICATION_CONVERSATION_THREAD: ApplicationConversationThread = {
  subject: null,
  strongestDetail: null,
  openHook: null,
  momentum: "new",
  applicantEnergy: "neutral",
  acknowledgedDetails: [],
}

const MOMENTUM_SET = new Set<string>(CONVERSATION_THREAD_MOMENTUM)
const ENERGY_SET = new Set<string>(APPLICANT_CONVERSATION_ENERGY)

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function conciseText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim().replace(/\s+/g, " ").slice(0, maximum)
  return text || null
}

export function normaliseApplicationConversationThread(
  raw: unknown,
): ApplicationConversationThread {
  const value = record(raw)
  if (!value) return { ...EMPTY_APPLICATION_CONVERSATION_THREAD }
  const momentum =
    typeof value.momentum === "string" && MOMENTUM_SET.has(value.momentum)
      ? (value.momentum as ConversationThreadMomentum)
      : "new"
  const applicantEnergy =
    typeof value.applicantEnergy === "string" && ENERGY_SET.has(value.applicantEnergy)
      ? (value.applicantEnergy as ApplicantConversationEnergy)
      : "neutral"
  const acknowledgedDetails = Array.isArray(value.acknowledgedDetails)
    ? [...new Set(value.acknowledgedDetails.flatMap((detail) => {
        const text = conciseText(detail, 160)
        return text ? [text] : []
      }))].slice(-4)
    : []
  return {
    subject: conciseText(value.subject, 120),
    strongestDetail: conciseText(value.strongestDetail, 200),
    openHook: conciseText(value.openHook, 200),
    momentum,
    applicantEnergy,
    acknowledgedDetails,
  }
}

export function collectApplicationConversationThread(
  messages: ConversationThreadMessage[],
): ApplicationConversationThread {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    const metadata = record(message.metadata)
    if (!metadata || !("conversation_thread" in metadata)) continue
    return normaliseApplicationConversationThread(metadata.conversation_thread)
  }
  return { ...EMPTY_APPLICATION_CONVERSATION_THREAD }
}

/** Deterministic fallback for local tests and older structured model output. */
export function fallbackApplicationConversationThread(input: {
  previous: ApplicationConversationThread
  currentAnswer: string
  assessment: ApplicationAnswerAssessment | null
}): ApplicationConversationThread {
  const answer = conciseText(input.currentAnswer, 200)
  if (!answer) return input.previous
  const quality = input.assessment?.quality
  return {
    subject: input.previous.subject ?? conciseText(answer, 120),
    strongestDetail:
      quality === "rich" || quality === "usable"
        ? answer
        : input.previous.strongestDetail,
    openHook: input.previous.openHook,
    momentum:
      quality === "rich"
        ? "high"
        : quality === "usable"
          ? "medium"
          : quality === "thin"
            ? "low"
            : quality === "concerning"
              ? "medium"
              : input.previous.momentum,
    applicantEnergy: input.previous.applicantEnergy,
    acknowledgedDetails: input.previous.acknowledgedDetails,
  }
}
