import type { ApplicationConversationDepth } from "@/lib/application-conversation-depth"
import {
  EMPTY_APPLICATION_CONVERSATION_THREAD,
  type ApplicationConversationThread,
} from "@/lib/application-conversation-thread"
import type { ApplicationResponseModeHistory } from "@/lib/application-response-mode"
import type { ApplicationBridgeHistory } from "@/lib/application-conversation-bridge"
import {
  EMPTY_APPLICATION_PARTICIPANT_ORIENTATION,
  type ApplicationParticipantOrientationState,
} from "@/lib/application-participant-orientation"
import {
  applicationQuestionBudget,
  type ApplicationQuestionBudget,
} from "@/lib/application-question-budget"
import { NATURAL_LANGUAGE_REPLY_GUIDANCE } from "@/lib/natural-language-style"
import {
  isApplicationProcessFeedback,
  type ApplicationFacts,
} from "@/lib/application-facts"

export type ApplicationSignalDefinition = {
  key: string
  kind:
    | "colors_relationship"
    | "music_relationship"
    | "tones_connection"
    | "motivation"
    | "artist_reference"
    | "recommendation"
    | "feedback"
    | "participation"
    | "contribution"
    | "custom"
  /** Original project configuration, retained for backwards compatibility. */
  label: string
  /** Neutral name shown in state and reports; never a question to ask. */
  evidenceLabel: string
  /** Private evidence goal. This is not a question Groucho must ask verbatim. */
  goal: string
  /** Optional routes Groucho can adapt when the conversation needs a new opening. */
  promptRoutes: string[]
  priority: "core" | "supporting"
  cluster: string
  /** Explicit conversational contexts that can make this goal relevant. */
  audiences: Array<"shared" | "artist" | "curator" | "enthusiast">
}

export type ApplicationSignalAnswer = ApplicationSignalDefinition & {
  answer: string
  /** False means the goal was attempted but the answer did not yet cover it. */
  covered?: boolean
  /** A direct answer was given, even if its evidence remains thin or unfavorable. */
  addressed?: boolean
  /** Exact applicant messages that supplied this evidence. */
  sources?: ApplicationSignalEvidenceSource[]
}

export type ApplicationSignalEvidenceSource = {
  messageId: string
  excerpt: string
}

export type ApplicationSignalMessage = {
  id?: string
  role: "user" | "assistant"
  content: string
  metadata?: unknown
}

const MAX_SIGNAL_KEY_LENGTH = 48
const MAX_COMPACT_ANSWER_LENGTH = 600
const DEFAULT_SOFT_QUESTION_TARGET = 9
const DEFAULT_MAX_FOLLOWUPS_PER_SIGNAL = 2

export const COLORS_FORUM_OPENING_QUESTION =
  "Why do you want to be an early applicant for the Forum?"

export const COLORS_FORUM_V1_RUBRIC = "colors_forum_v1" as const
export const COLORS_FORUM_MEMBERSHIP_RUBRIC = "colors_forum_membership_v1" as const

/** Post-conversation lenses for the initial discussion Forum; never live questions. */
const COLORS_FORUM_MEMBERSHIP_SIGNALS: ApplicationSignalDefinition[] = [
  {
    key: "joining_motivation", kind: "motivation", label: "Joining motivation",
    evidenceLabel: "Joining motivation",
    goal: "Why this person wants to join and what they hope the Forum will make possible.",
    promptRoutes: [], priority: "core", cluster: "orientation", audiences: ["shared"],
  },
  {
    key: "colors_connection", kind: "colors_relationship", label: "COLORS connection",
    evidenceLabel: "COLORS connection",
    goal: "Their actual prior connection to COLORS, including shows or artists when named. Unfamiliarity is neutral.",
    promptRoutes: [], priority: "supporting", cluster: "colors_relationship", audiences: ["shared"],
  },
  {
    key: "music_relationship", kind: "music_relationship", label: "Music relationship",
    evidenceLabel: "Music relationship",
    goal: "How music features in their life as a listener, maker, scene participant or another role they describe; no mode has higher status.",
    promptRoutes: [], priority: "core", cluster: "cultural_point_of_view", audiences: ["shared"],
  },
  {
    key: "community_participation", kind: "participation", label: "Community participation",
    evidenceLabel: "Community participation",
    goal: "How they currently take part with other people in online or offline communities; listening, discussion, contextual sharing and organising may all count equally.",
    promptRoutes: [], priority: "core", cluster: "participation", audiences: ["shared"],
  },
  {
    key: "forum_participation", kind: "contribution", label: "Forum participation",
    evidenceLabel: "Forum participation",
    goal: "A specific way they themselves say they would take part at first. A general wish for other people to talk is a Forum hope, not a personal plan. Quiet participation counts.",
    promptRoutes: [], priority: "supporting", cluster: "forum_hopes", audiences: ["shared"],
  },
  {
    key: "tones_connection", kind: "tones_connection", label: "TONES connection",
    evidenceLabel: "TONES connection",
    goal: "Their stated awareness of or first-hand experience with TONES, if any. Lack of familiarity or attendance is neutral and never a material gap.",
    promptRoutes: [], priority: "supporting", cluster: "tones_connection", audiences: ["shared"],
  },
]

export function colorsForumMembershipSignalDefinitions(): ApplicationSignalDefinition[] {
  return COLORS_FORUM_MEMBERSHIP_SIGNALS.map((signal) => ({
    ...signal,
    promptRoutes: [...signal.promptRoutes],
    audiences: [...signal.audiences],
  }))
}

/** Fixed evidence IDs for new COLORS Forum sessions; labels are display text only. */
const COLORS_FORUM_V1_SIGNALS: ApplicationSignalDefinition[] = [
  {
    key: "forum_hopes",
    kind: "motivation",
    label: "Forum hopes",
    evidenceLabel: "Forum hopes",
    goal: "Understand what they hope to find, experience, or make possible in the Forum, and why that matters to them. Aspirations are not evidence of existing practice.",
    promptRoutes: ["What would make this Forum worth returning to for you?"],
    priority: "core",
    cluster: "orientation",
    audiences: ["shared"],
  },
  {
    key: "community_participation",
    kind: "participation",
    label: "Community participation",
    evidenceLabel: "Community participation",
    goal: "Understand how they participate in online or offline communities now: listening, discussing, welcoming, organising, or sustaining an exchange. Music relevance is helpful, not compulsory.",
    promptRoutes: ["Where does music or creative work become a conversation with other people for you?"],
    priority: "core",
    cluster: "participation_and_contribution",
    audiences: ["shared"],
  },
  {
    key: "reciprocal_contribution",
    kind: "contribution",
    label: "Reciprocal contribution",
    evidenceLabel: "Reciprocal contribution",
    goal: "Understand what they might give as well as receive: a specific, realistic exchange they already make or could sustain in the Forum. Quiet participation counts; constant posting and unpaid labour are not expected.",
    promptRoutes: ["What do you find yourself giving back in a community you value?"],
    priority: "core",
    cluster: "participation_and_contribution",
    audiences: ["shared"],
  },
  {
    key: "artist_engagement",
    kind: "artist_reference",
    label: "Artist engagement",
    evidenceLabel: "Artist engagement",
    goal: "Understand a particular artist or creative work they care about, or an explicit way they would like to engage with artists. A generic listening or discussion habit alone is not artist-engagement evidence. Naming a niche artist is welcome context, not a credential test.",
    promptRoutes: ["Is there an artist whose work you would enjoy discussing with others here?"],
    priority: "supporting",
    cluster: "cultural_point_of_view",
    audiences: ["shared"],
  },
  {
    key: "colors_relationship",
    kind: "colors_relationship",
    label: "Relationship to COLORS",
    evidenceLabel: "Relationship to COLORS",
    goal: "Understand their actual relationship to COLORS, including experiences, perceptions, and what the Forum could extend. Familiarity and niche knowledge may enrich the brief but are not deciding factors.",
    promptRoutes: ["What about COLORS makes this Forum feel like the right place for you?"],
    priority: "supporting",
    cluster: "colors_relationship",
    audiences: ["shared"],
  },
]

export function colorsForumV1SignalDefinitions(): ApplicationSignalDefinition[] {
  return COLORS_FORUM_V1_SIGNALS.map((signal) => ({
    ...signal,
    promptRoutes: [...signal.promptRoutes],
    audiences: [...signal.audiences],
  }))
}

export function isColorsForumV1SignalSet(definitions: ApplicationSignalDefinition[]): boolean {
  return definitions.length === COLORS_FORUM_V1_SIGNALS.length &&
    COLORS_FORUM_V1_SIGNALS.every((signal) =>
      definitions.some((definition) => definition.key === signal.key),
    )
}

const COLORS_RELATIONSHIP_SIGNAL: ApplicationSignalDefinition = {
  key: "colors_relationship",
  kind: "colors_relationship",
  label: "Relationship to COLORS",
  evidenceLabel: "Relationship to COLORS",
  goal: "Understand why COLORS specifically matters to them, how they have engaged with its work, and what they believe the Forum could extend.",
  promptRoutes: [
    "You could look for community in a lot of places—why does COLORS feel like the right one?",
    "What does COLORS make room for that you do not find elsewhere?",
    "Is there a COLORS performance that changed how you heard an artist?",
    "What could the Forum make possible that the performances cannot?",
  ],
  priority: "core",
  cluster: "colors_relationship",
  audiences: ["shared"],
}

function evidenceGoal(
  label: string,
): Pick<
  ApplicationSignalDefinition,
  "kind" | "evidenceLabel" | "goal" | "promptRoutes" | "priority" | "cluster" | "audiences"
> {
  const normalized = label.trim().toLowerCase()
  if (
    normalized.includes("relationship to colors") ||
    normalized.includes("why colors") ||
    normalized.includes("colors specifically")
  ) {
    return {
      kind: "colors_relationship",
      evidenceLabel: "Relationship to COLORS",
      goal: COLORS_RELATIONSHIP_SIGNAL.goal,
      promptRoutes: [...COLORS_RELATIONSHIP_SIGNAL.promptRoutes],
      priority: COLORS_RELATIONSHIP_SIGNAL.priority,
      cluster: COLORS_RELATIONSHIP_SIGNAL.cluster,
      audiences: [...COLORS_RELATIONSHIP_SIGNAL.audiences],
    }
  }
  if (
    normalized.includes("what brought you here") ||
    normalized === "motivation for joining"
  ) {
    return {
      kind: "motivation",
      evidenceLabel: "Motivation for joining",
      goal: "Understand their motivation and relationship to the Forum.",
      promptRoutes: ["What drew you towards this community?", "What are you hoping to find or take part in here?"],
      priority: "supporting",
      cluster: "orientation",
      audiences: ["shared"],
    }
  }
  if (
    normalized.includes("artist more people should know") ||
    normalized === "cultural point of view"
  ) {
    return {
      kind: "artist_reference",
      evidenceLabel: "Cultural point of view",
      goal: "Hear a personal cultural point of view through a specific artist or creative reference.",
      promptRoutes: ["Who is making work you think deserves more attention?", "What do people tend to miss about work you care about?"],
      priority: "core",
      cluster: "cultural_point_of_view",
      audiences: ["shared"],
    }
  }
  if (
    (normalized.includes("last song") && normalized.includes("recommend")) ||
    normalized === "music shared with others"
  ) {
    return {
      kind: "recommendation",
      evidenceLabel: "Music shared with others",
      goal: "Hear one identifiable song they have actually recommended or shared, and why they thought that specific song was worth someone else's attention.",
      promptRoutes: [
        "What is one of their songs that you have shared with someone, and why?",
        "What is a song you have actually shared with someone, and what made it worth their attention?",
      ],
      priority: "supporting",
      cluster: "cultural_point_of_view",
      audiences: ["shared"],
    }
  }
  if (normalized.includes("unfinished music") || normalized === "care and feedback") {
    return {
      kind: "feedback",
      evidenceLabel: "Care and feedback",
      goal: "Understand their care, honesty, and judgment when responding to unfinished work.",
      promptRoutes: ["How do you approach feedback when the work is not naturally for you?", "What does useful honesty look like with unfinished work?"],
      priority: "core",
      cluster: "care_and_feedback",
      audiences: ["curator"],
    }
  }
  if (
    normalized.includes("which sounds most like you") ||
    normalized === "ways of taking part"
  ) {
    return {
      kind: "participation",
      evidenceLabel: "Ways of taking part",
      goal: "Understand how they currently participate in music culture and community, including the exchanges and habits that keep them involved over time.",
      promptRoutes: [
        "How do you usually participate around music?",
        "What do you find yourself returning to or giving back in music communities?",
      ],
      priority: "core",
      cluster: "participation_and_contribution",
      audiences: ["shared"],
    }
  }
  if (normalized.includes("first month") || normalized.includes("contribut")) {
    return {
      kind: "contribution",
      evidenceLabel: "Potential contribution",
      goal: "Find a concrete, realistic contribution pattern: what they already give or return to, and what they could sustain in the Forum.",
      promptRoutes: [
        "What do you already find yourself giving back in music communities?",
        "Which part of that could you realistically keep doing here?",
        "What might you actually start, share, or help with here?",
      ],
      priority: "core",
      cluster: "participation_and_contribution",
      audiences: ["shared"],
    }
  }
  return {
    kind: "custom",
    evidenceLabel: label.trim().replace(/[?]+$/, ""),
    goal: `Understand the applicant's evidence for: ${label.trim()}`,
    promptRoutes: [label.trim()],
    priority: "core",
    cluster: signalKey(label, 0),
    audiences: ["shared"],
  }
}

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
  const definitions = requiredSignals.map((label, index) => {
    const base = signalKey(label, index)
    let key = base
    let suffix = 2
    while (used.has(key)) {
      const suffixText = `_${suffix}`
      key = `${base.slice(0, MAX_SIGNAL_KEY_LENGTH - suffixText.length)}${suffixText}`
      suffix += 1
    }
    used.add(key)
    return { key, label, ...evidenceGoal(label) }
  })
  if (
    isColorsForumSignalSet(definitions) &&
    !definitions.some((signal) => signal.cluster === "colors_relationship")
  ) {
    const orientationIndex = definitions.findIndex(
      (signal) => signal.cluster === "orientation",
    )
    const insertionIndex = orientationIndex >= 0 ? orientationIndex + 1 : 0
    definitions.splice(insertionIndex, 0, {
      ...COLORS_RELATIONSHIP_SIGNAL,
      promptRoutes: [...COLORS_RELATIONSHIP_SIGNAL.promptRoutes],
      audiences: [...COLORS_RELATIONSHIP_SIGNAL.audiences],
    })
  }
  return definitions
}

export function isColorsForumSignalSet(
  definitions: ApplicationSignalDefinition[],
): boolean {
  if (isColorsForumV1SignalSet(definitions)) return true
  const clusters = new Set(definitions.map((signal) => signal.cluster))
  return (
    clusters.has("orientation") &&
    clusters.has("cultural_point_of_view") &&
    clusters.has("care_and_feedback") &&
    clusters.has("participation_and_contribution")
  )
}

/** A missing marker on an existing conversation means its original rubric stays in force. */
export function colorsForumRubricForHistory(
  history: ApplicationSignalMessage[],
  configuredDefinitions: ApplicationSignalDefinition[],
): typeof COLORS_FORUM_V1_RUBRIC | null {
  if (history.some((message) =>
    metadataRecord(message.metadata)?.application_rubric_version === COLORS_FORUM_V1_RUBRIC,
  )) return COLORS_FORUM_V1_RUBRIC
  return history.length === 0 && isColorsForumSignalSet(configuredDefinitions)
    ? COLORS_FORUM_V1_RUBRIC
    : null
}

export function applicationOpeningMessageForSignals(
  configuredOpening: string,
  definitions: ApplicationSignalDefinition[],
): string {
  return isColorsForumSignalSet(definitions)
    ? COLORS_FORUM_OPENING_QUESTION
    : configuredOpening
}

/**
 * Kept as a compatibility boundary for callers and stored tests. Orientation is
 * descriptive context only: it must not add, remove, reprioritise, or rewrite
 * evidence goals.
 */
export function applicationSignalDefinitionsForOrientation(
  definitions: ApplicationSignalDefinition[],
  orientation: ApplicationParticipantOrientationState,
): ApplicationSignalDefinition[] {
  void orientation
  return definitions
}

/**
 * Conditional goals become eligible only when the conversational model records
 * them as semantically relevant. Code validates stable keys; it does not try to
 * rediscover meaning through a vocabulary list.
 */
export function applicationSignalDefinitionsForEvidence(
  definitions: ApplicationSignalDefinition[],
  relevantSignalKeys: Iterable<string> = [],
): ApplicationSignalDefinition[] {
  if (!isColorsForumSignalSet(definitions)) return definitions
  const relevant = new Set(relevantSignalKeys)
  return definitions.filter(
    (signal) =>
      signal.audiences.includes("shared") ||
      relevant.has(signal.key),
  )
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }
  return metadata as Record<string, unknown>
}

function metadataHasField(metadata: unknown, field: string): boolean {
  const value = metadataRecord(metadata)
  return value ? Object.prototype.hasOwnProperty.call(value, field) : false
}

function signalsFromMetadata(
  metadata: unknown,
  field: "application_signal" | "application_signals" | "application_next_signal" | "application_relevant_signals",
  definitions: ApplicationSignalDefinition[],
): ApplicationSignalDefinition[] {
  const record = metadataRecord(metadata)
  const raw = record?.[field]
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  const found = values.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const key = (item as Record<string, unknown>).key
    if (typeof key !== "string") return []
    const signal = definitions.find((definition) => definition.key === key)
    return signal ? [signal] : []
  })
  return [...new Map(found.map((signal) => [signal.key, signal])).values()]
}

export function collectApplicationRelevantSignalKeys(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
): Set<string> {
  return new Set(messages.flatMap((message) => [
    ...signalsFromMetadata(
      message.metadata,
      "application_relevant_signals",
      definitions,
    ),
    ...signalsFromMetadata(message.metadata, "application_signal", definitions),
    ...signalsFromMetadata(
      message.metadata,
      "application_next_signal",
      definitions,
    ),
  ].map((signal) => signal.key)))
}

export function newlyCoveredApplicationSignalKeys(
  proposedKeys: Iterable<string>,
  definitions: ApplicationSignalDefinition[],
  priorAnswers: ApplicationSignalAnswer[],
): string[] {
  const configured = new Set(definitions.map((signal) => signal.key))
  const previouslyCovered = new Set(
    priorAnswers
      .filter((answer) => answer.covered !== false)
      .map((answer) => answer.key),
  )
  return [...new Set(proposedKeys)].filter(
    (key) => configured.has(key) && !previouslyCovered.has(key),
  )
}

export function collectApplicationSignalAnswers(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
): ApplicationSignalAnswer[] {
  const answers = new Map<string, ApplicationSignalAnswer>()
  for (const message of messages) {
    if (message.role !== "user") continue
    if (isApplicationProcessFeedback(message.metadata)) continue
    const hasCoverage = metadataHasField(message.metadata, "application_signals")
    const coveredSignals = signalsFromMetadata(message.metadata, "application_signals", definitions)
    const promptedSignals = signalsFromMetadata(message.metadata, "application_signal", definitions)
    const signals = hasCoverage
      ? [...new Map([...promptedSignals, ...coveredSignals].map((signal) => [signal.key, signal])).values()]
      : promptedSignals
    if (!signals.length) continue
    const answer = message.content.trim()
    if (!answer) continue
    for (const signal of signals) {
      const relation = metadataRecord(
        metadataRecord(message.metadata)?.application_answer_relation,
      )
      const previous = answers.get(signal.key)?.answer
      const combined = previous ? `${previous}\nFollow-up: ${answer}` : answer
      answers.set(signal.key, {
        ...signal,
        answer: combined.slice(0, MAX_COMPACT_ANSWER_LENGTH),
        sources: withEvidenceSource(
          answers.get(signal.key)?.sources,
          message.id,
          answer,
        ),
        covered: hasCoverage
          ? coveredSignals.some((covered) => covered.key === signal.key) || previousAnswerCovered(answers.get(signal.key))
          : true,
        ...(
          coveredSignals.some((covered) => covered.key === signal.key) ||
          (promptedSignals.some((prompted) => prompted.key === signal.key) &&
            relation?.kind === "direct") ||
          answers.get(signal.key)?.addressed === true
            ? { addressed: true }
            : {}
        ),
      })
    }
  }
  let collected = definitions.flatMap((signal) => {
    const answer = answers.get(signal.key)
    return answer ? [answer] : []
  })
  const userById = new Map(messages.flatMap((message) =>
    message.role === "user" && message.id ? [[message.id, message]] as const : [],
  ))
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const raw = metadataRecord(message.metadata)?.application_recovered_signal_evidence
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      const recovered = metadataRecord(item)
      const signal = definitions.find((candidate) => candidate.key === recovered?.signalKey)
      const sourceId = recovered?.sourceMessageId
      const source = typeof sourceId === "string" ? userById.get(sourceId) : null
      if (!signal || !source?.id || !source.content.trim()) continue
      if (isApplicationProcessFeedback(source.metadata)) continue
      if (collected.find((answer) => answer.key === signal.key)?.sources?.some(
        (entry) => entry.messageId === source.id,
      )) {
        collected = markCoveredSignals(collected, [signal])
      } else {
        collected = withCurrentSignalAnswer(
          collected,
          signal,
          source.content,
          true,
          source.id,
        )
      }
    }
  }
  return collected
}

export function collectApplicationInsufficientEvidenceKeys(
  messages: ApplicationSignalMessage[],
): Set<string> {
  const keys = new Set<string>()
  for (const message of messages) {
    if (message.role !== "user") continue
    const value = metadataRecord(message.metadata)?.application_insufficient_evidence
    const entries = Array.isArray(value) ? value : value ? [value] : []
    for (const entry of entries) {
      const key = metadataRecord(entry)?.key
      if (typeof key === "string") keys.add(key)
    }
  }
  return keys
}

function previousAnswerCovered(answer: ApplicationSignalAnswer | undefined): boolean {
  return Boolean(answer && answer.covered !== false)
}

function previousAnswerHandled(answer: ApplicationSignalAnswer | undefined): boolean {
  return previousAnswerCovered(answer) || answer?.addressed === true
}

function withEvidenceSource(
  sources: ApplicationSignalEvidenceSource[] | undefined,
  messageId: string | undefined,
  answer: string,
): ApplicationSignalEvidenceSource[] | undefined {
  if (!messageId) return sources
  const source = {
    messageId,
    excerpt: answer.trim().replace(/\s+/g, " ").slice(0, 260),
  }
  return [
    ...(sources ?? []).filter((item) => item.messageId !== messageId),
    source,
  ]
}

export function hasLegacyUntaggedAnswers(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
): boolean {
  return messages.some((message, index) => {
    if (message.role !== "user") return false
    if (isApplicationProcessFeedback(message.metadata)) return false
    const previous = messages[index - 1]
    const followsConversationalThread =
      previous?.role === "assistant" &&
      metadataRecord(previous.metadata)?.application_conversation_thread_turn === true
    return (
      !followsConversationalThread &&
      signalsFromMetadata(message.metadata, "application_signals", definitions).length === 0 &&
      signalsFromMetadata(message.metadata, "application_signal", definitions).length === 0
    )
  })
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
    if (
      metadataRecord(message.metadata)?.application_conversation_thread_turn ===
      true
    ) {
      return null
    }
    requestedSignal = signalsFromMetadata(
      message.metadata,
      "application_next_signal",
      definitions,
    )[0] ?? null
    break
  }
  if (requestedSignal) return requestedSignal
  const answered = new Set(answers.filter(previousAnswerHandled).map((answer) => answer.key))
  return definitions.find((signal) => !answered.has(signal.key)) ?? null
}

export function withCurrentSignalAnswer(
  answers: ApplicationSignalAnswer[],
  signal: ApplicationSignalDefinition | null,
  currentAnswer: string,
  covered = true,
  sourceMessageId?: string,
): ApplicationSignalAnswer[] {
  if (!signal || !currentAnswer.trim()) return answers
  const next = answers.filter((answer) => answer.key !== signal.key)
  const previous = answers.find((answer) => answer.key === signal.key)?.answer
  const combined = previous
    ? `${previous}\nFollow-up: ${currentAnswer.trim()}`
    : currentAnswer.trim()
  next.push({
    ...signal,
    answer: combined.slice(0, MAX_COMPACT_ANSWER_LENGTH),
    sources: withEvidenceSource(
      answers.find((answer) => answer.key === signal.key)?.sources,
      sourceMessageId,
      currentAnswer,
    ),
    covered: covered || previousAnswerCovered(answers.find((answer) => answer.key === signal.key)),
    ...(answers.find((answer) => answer.key === signal.key)?.addressed === true
      ? { addressed: true }
      : {}),
  })
  return next
}

export function withCoveredSignalAnswers(
  answers: ApplicationSignalAnswer[],
  signals: ApplicationSignalDefinition[],
  currentAnswer: string,
  sourceMessageId?: string,
): ApplicationSignalAnswer[] {
  if (!currentAnswer.trim() || signals.length === 0) return answers
  const marked = markCoveredSignals(answers, signals)
  return signals.reduce((next, signal) => {
    if (next.some((answer) => answer.key === signal.key)) {
      return next.map((answer) =>
        answer.key === signal.key
          ? {
              ...answer,
              sources: withEvidenceSource(
                answer.sources,
                sourceMessageId,
                currentAnswer,
              ),
            }
          : answer,
      )
    }
    return withCurrentSignalAnswer(
      next,
      signal,
      currentAnswer,
      true,
      sourceMessageId,
    )
  }, marked)
}

export function markCoveredSignals(
  answers: ApplicationSignalAnswer[],
  signals: ApplicationSignalDefinition[],
): ApplicationSignalAnswer[] {
  const coveredKeys = new Set(signals.map((signal) => signal.key))
  return answers.map((answer) =>
    coveredKeys.has(answer.key) ? { ...answer, covered: true, addressed: true } : answer,
  )
}

export function markAddressedSignals(
  answers: ApplicationSignalAnswer[],
  signals: ApplicationSignalDefinition[],
): ApplicationSignalAnswer[] {
  const addressedKeys = new Set(signals.map((signal) => signal.key))
  return answers.map((answer) =>
    addressedKeys.has(answer.key) ? { ...answer, addressed: true } : answer,
  )
}

export function applicationSignalAnswerAttemptCount(
  answer: ApplicationSignalAnswer | undefined,
): number {
  if (!answer?.answer.trim()) return 0
  return answer.answer.split("\nFollow-up:").length
}

export function resolveNextApplicationSignal(
  requestedKey: string | null,
  definitions: ApplicationSignalDefinition[],
  answers: ApplicationSignalAnswer[],
  currentSignal: ApplicationSignalDefinition | null,
  fallbackToOpen = true,
): ApplicationSignalDefinition | null {
  const answered = new Set(answers.filter(previousAnswerHandled).map((answer) => answer.key))
  const nextMissing = definitions.find((signal) => !answered.has(signal.key)) ?? null
  if (requestedKey) {
    const requested = definitions.find((signal) => signal.key === requestedKey)
    if (requested && (requested.key === currentSignal?.key || !answered.has(requested.key))) {
      return requested
    }
  }
  return fallbackToOpen ? nextMissing ?? currentSignal ?? null : null
}

export function unattemptedCoreApplicationSignals(
  definitions: ApplicationSignalDefinition[],
  answers: ApplicationSignalAnswer[],
): ApplicationSignalDefinition[] {
  return definitions.filter(
    (signal) =>
      signal.priority === "core" &&
      !answers.some((answer) => answer.key === signal.key),
  )
}

export function shouldDeferApplicationTerminal(input: {
  terminalRequested: boolean
  phase: ApplicationQuestionBudget["phase"]
  currentAnswerConcerning: boolean
  answeredQuestions: number
  remainingQuestions: number
  definitions: ApplicationSignalDefinition[]
  answers: ApplicationSignalAnswer[]
}): boolean {
  return (
    input.terminalRequested &&
    !input.currentAnswerConcerning &&
    input.answeredQuestions <= 1 &&
    input.remainingQuestions > 0
  )
}

export function applicationSignalMetadata(
  signal: ApplicationSignalDefinition | null,
): Record<string, string> | undefined {
  return signal ? { key: signal.key, label: signal.evidenceLabel } : undefined
}

export function buildCompactApplicationStateMessage(input: {
  definitions: ApplicationSignalDefinition[]
  answers: ApplicationSignalAnswer[]
  currentSignal: ApplicationSignalDefinition | null
  currentQuestion: string
  currentAnswer: string
  recentApplicantAnswers?: string[]
  answeredQuestionCount?: number
  maxQuestions?: number
  maxFollowupsPerSignal?: number
  conversationDepth?: ApplicationConversationDepth
  conversationThread?: ApplicationConversationThread
  responseModeHistory?: ApplicationResponseModeHistory
  bridgeHistory?: ApplicationBridgeHistory
  questionBudget?: ApplicationQuestionBudget
  participantOrientation?: ApplicationParticipantOrientationState
  adaptiveOrientationEnabled?: boolean
  insufficientEvidenceKeys?: Set<string>
  relevantSignalKeys?: Set<string>
  facts?: ApplicationFacts
  integrityConcerns?: Array<{ kind: string; sourceMessageId?: string; quote?: string }>
  mediaExerciseAvailable?: boolean
  mediaCatalog?: Array<{
    id: string
    title: string
    artist?: string
    availableFormats: string[]
  }>
}): string {
  const answersByKey = new Map(input.answers.map((answer) => [answer.key, answer]))
  const relevantDefinitions = applicationSignalDefinitionsForEvidence(
    input.definitions,
    input.relevantSignalKeys,
  )
  const relevantSignalKeys = new Set(
    relevantDefinitions.map((signal) => signal.key),
  )
  const orientation =
    input.participantOrientation ??
    EMPTY_APPLICATION_PARTICIPANT_ORIENTATION
  const suggestedGapSignalKey = isColorsForumSignalSet(input.definitions)
    ? null
    : relevantDefinitions.find(
        (signal) => !previousAnswerHandled(answersByKey.get(signal.key)),
      )?.key ?? null
  const maxQuestions = input.maxQuestions ?? DEFAULT_SOFT_QUESTION_TARGET
  const maxFollowupsPerSignal =
    input.maxFollowupsPerSignal ?? DEFAULT_MAX_FOLLOWUPS_PER_SIGNAL
  const answeredQuestionCount =
    input.answeredQuestionCount ??
    input.answers.reduce(
      (total, answer) => total + applicationSignalAnswerAttemptCount(answer),
      0,
    )
  const resolvedQuestionBudget = input.questionBudget ?? applicationQuestionBudget({
    answeredQuestions: answeredQuestionCount,
    maxQuestions,
  })
  const recommendationSignalKey =
    input.definitions.find((signal) => signal.kind === "recommendation")?.key ?? null
  const ownMusicSignalKeys = input.definitions
    .filter(
      (signal) =>
        signal.cluster === "cultural_point_of_view" ||
        signal.cluster === "participation_and_contribution",
    )
    .map((signal) => signal.key)
  const situatedPerspectiveSignalKeys = input.definitions
    .filter(
      (signal) =>
        signal.cluster === "cultural_point_of_view" ||
        signal.cluster === "participation_and_contribution",
    )
    .map((signal) => signal.key)
  const crossoverSignalKeys = relevantDefinitions
    .filter(
      (signal) =>
        signal.cluster === "care_and_feedback" ||
        signal.cluster === "participation_and_contribution" ||
        signal.cluster === "cultural_point_of_view",
    )
    .map((signal) => signal.key)
  const state = {
    ...(isColorsForumV1SignalSet(input.definitions)
      ? { rubricVersion: COLORS_FORUM_V1_RUBRIC }
      : {}),
    questionBudget: {
      ...resolvedQuestionBudget,
      maxFollowupsPerSignal,
    },
    signals: input.definitions.map((signal) => {
      const answer = answersByKey.get(signal.key)
      const attempts = applicationSignalAnswerAttemptCount(answer)
      const followupCount = Math.max(0, attempts - 1)
      return {
        key: signal.key,
        evidenceLens: signal.evidenceLabel,
        evidenceGoal: signal.goal ?? evidenceGoal(signal.label).goal,
        ...(!isColorsForumSignalSet(input.definitions)
          ? { exampleQuestions: signal.promptRoutes ?? evidenceGoal(signal.label).promptRoutes }
          : {}),
        priority: signal.priority ?? evidenceGoal(signal.label).priority,
        cluster: signal.cluster ?? evidenceGoal(signal.label).cluster,
        relevance: signal.audiences.includes("shared")
          ? "shared"
          : relevantSignalKeys.has(signal.key)
            ? "explicit"
            : "conditional",
        status: previousAnswerCovered(answer)
          ? "observed"
          : answer?.addressed
            ? "addressed_insufficient_evidence"
          : input.insufficientEvidenceKeys?.has(signal.key)
            ? "insufficient_evidence"
            : "open",
        attempts,
        followupCount,
        followupsRemaining: Math.max(
          0,
          maxFollowupsPerSignal - followupCount,
        ),
        ...(answer ? { answer: answer.answer, sources: answer.sources ?? [] } : {}),
      }
    }),
    current: {
      signalKey: input.currentSignal?.key ?? null,
      signalLabel: input.currentSignal?.evidenceLabel ?? null,
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
            return { attempts, followupCount, followupsRemaining }
          })()
        : {}),
    },
    recentApplicantAnswers: (input.recentApplicantAnswers ?? [])
      .slice(-4)
      .map((answer) => answer.trim().replace(/\s+/g, " ").slice(0, 400))
      .filter(Boolean),
    conversationDepth: input.conversationDepth ?? {
      recentQualities: [],
      thinAnswerCount: 0,
      richAnswerCount: 0,
      concerningAnswerCount: 0,
      openDoorUsed: false,
      thinSignalCount: 0,
    },
    conversationThread:
      input.conversationThread ?? EMPTY_APPLICATION_CONVERSATION_THREAD,
    responseModeHistory: input.responseModeHistory ?? {
      recentModes: [],
      lastMode: null,
      repeatedModeCount: 0,
    },
    bridgeHistory: input.bridgeHistory ?? {
      recentKinds: [],
      lastKind: null,
      repeatedKindCount: 0,
    },
    ...(input.adaptiveOrientationEnabled
      ? {
          participantOrientation: orientation,
          orientationLenses: isColorsForumV1SignalSet(input.definitions) ? {
            rule: "Descriptive context only. Do not choose, require, or score evidence goals from this label.",
            shared: "All applicants can show community participation, Forum hopes, reciprocal contribution, artist engagement, and a COLORS relationship in different ways.",
            artist: "Follow creative practice and desired exchange if the applicant introduces them; artist status is not a requirement.",
            curator: "Follow concrete selection, hosting, context, or connection if it appears; do not require curation.",
            enthusiast: "Thoughtful listening and community exchange are valid participation without formal creative credits.",
            hybrid: "Follow the live crossover without asking the applicant to prove every role.",
          } : {
            rule:
              "Descriptive context only. Never use an orientation label or score to add, remove, force, or prioritise an evidence goal. Goal relevance comes from explicit conversational evidence.",
            fluidity:
              "These are overlapping, changing facets rather than fixed positions. Follow practices and intentions that cross the current description without announcing a relabelling.",
            shared:
              "All applicants may show motivation, cultural attention, relationship to community, and a realistic form of participation.",
            artist:
              "Explore their creative practice, what they are trying to make or express, what exchange they seek, and what maker perspective they could share. Do not require the hypothetical unfinished-work feedback route.",
            curator:
              "Test concrete participation: what they select, organise, introduce, document, host, or connect; their role, judgment, consequence, and responsibility to people involved.",
            enthusiast:
              "Explore what music community means to them, what they hope to discover or understand, where music becomes social for them, and what would help them participate. Listening is a valid orientation and lack of formal curation is neutral.",
            hybrid:
              "Use only the relevant goals from the roles they actually evidence. Do not make them prove every possible branch.",
          },
        }
      : {}),
    bridgeGrammar: [
      "person_to_work",
      "work_to_detail",
      "judgment_to_reason",
      "personal_connection_to_origin",
      "maker_to_practice",
      "action_to_consequence",
      "sharing_to_selection",
      ...(isColorsForumV1SignalSet(input.definitions) ? [] : ["feedback_to_care"]),
      "aspiration_to_contribution",
      "tension_to_judgment",
      "callback",
    ],
    priorityConversationBridges: isColorsForumV1SignalSet(input.definitions) ? {
      communityToHopes: "When they describe a community experience, explore what kind of exchange they hope the Forum could add only if that remains unclear.",
      practiceToContribution: "When they describe something they already do, ask whether and how it could continue here; preserve the difference between a current habit and a proposed plan.",
      artistToEngagement: "When they name an artist or work, follow what they value and how they would like to engage with artists or other listeners; do not demand a song title or critique.",
      colorsToForum: "When they describe a COLORS experience, explore what the Forum might extend beyond watching performances, if that is still open.",
    } : {
      artistToSong: {
        trigger:
          "The current thread identifies an artist and the recommendation goal is still open.",
        route:
          "Keep the artist as the subject. Ask: What is one of their songs that you have—or would—share with someone, and why?",
        preferredNextSignalKey: recommendationSignalKey,
      },
      albumMention: {
        trigger:
          "The current answer mentions or centres a particular album, LP, or record.",
        route:
          "Respond to that album specifically, then ask which song from it they would recommend and why that track.",
        preferredNextSignalKey: recommendationSignalKey,
      },
      applicantMakesMusic: {
        trigger:
          "The applicant says they make, release, write, produce, perform, or share their own music.",
        route:
          "Follow the disclosure with a natural response about the music they make: what they are making, what they are trying to express, or what part of their practice connects to the artist they mentioned. A specific observation may lead into at most one question. Choose one intent only.",
        selectionPriority:
          "When this is a fresh disclosure and a core maker, participation, or contribution goal is open, prefer it over artist-to-song or another supporting recommendation bridge.",
        candidateSignalKeys: ownMusicSignalKeys,
      },
      localSceneContext: {
        trigger:
          "The applicant mentions a city, local scene, venue, event, collective, online scene, or feeling inside, adjacent to, or outside a music community.",
        route:
          "Stay with that context. Ask what is happening there that outsiders might miss, how it shapes their perspective, or where they genuinely sit within it. Use one route only and reuse the place or scene only when the applicant supplied it.",
        boundaries:
          "Do not ask for an exact location, reward prestigious cities, equate industry proximity with insight, or treat being outside a scene as a weakness.",
        candidateSignalKeys: situatedPerspectiveSignalKeys,
      },
      roleCrossover: {
        trigger:
          "The applicant reveals a practice or credible intention beyond their current primary orientation: an artist collaborating or curating, a listener wanting to organise or select, or a curator making and sharing their own work.",
        route:
          "Stay with the newly revealed possibility while it has momentum. Ask about the concrete exchange, action, work, or responsibility they mean rather than testing whether they qualify for a new label.",
        evidenceBoundary:
          "A future intention may open a conversation, but preserve the difference between something they want to begin and something they already do. Do not rewrite aspiration as established practice.",
        candidateSignalKeys: crossoverSignalKeys,
      },
    },
    suggestedGapSignalKey,
    mediaExerciseAvailable: input.mediaExerciseAvailable === true,
    mediaCatalog: input.mediaCatalog ?? [],
    ...(input.facts ? { durableFacts: input.facts } : {}),
    ...(input.integrityConcerns?.length
      ? { unresolvedIntegrityObservations: input.integrityConcerns.map((item) => ({
          kind: item.kind,
          sourceMessageId: item.sourceMessageId ?? null,
          quote: item.quote ?? null,
        })) }
      : {}),
  }

  if (isColorsForumV1SignalSet(input.definitions)) {
    return `Review this compact COLORS Forum application state and produce Groucho's next turn.

${NATURAL_LANGUAGE_REPLY_GUIDANCE}

The stable signal keys in state.signals are private evidence IDs, not a sequence of questions. Assess current.answer semantically as thin, usable, rich, or concerning: a concise concrete preference, intention, practice, or observation is usable. Return every key newly supported by THIS answer in coveredSignalKeys, even if the current question aimed at a different lens. A critical or negative answer can still cover a lens. One answer can cover several; an open lens is uncertainty, not a reason to interrogate the applicant. Do not copy evidence from earlier answers into this turn's coverage. Keep established activity, one-off action, and aspiration distinct.

Learn what community the applicant already participates in, what reciprocal exchange they could sustain, what they hope this Forum offers, how they engage with artists, and their actual relationship to COLORS. This is not an artist-submission review, a curation exam, or a fandom quiz. Online communities and quiet but thoughtful participation count. Familiarity with lesser-known COLORS work can enrich context but is not required. Applicant orientation is descriptive, never a routing decision or status judgment.

Compare current.answer with current.question. Return answerRelation direct, partial, subject_shift, ambiguous, or clarification_request as appropriate. A request to clarify your wording is process feedback, not applicant-fit evidence: own the unclear question and restate one specific invitation on the same subject. If the applicant asks to leave a covered subject, honour that request. If they correct an assumption, acknowledge it and preserve their stated facts. For a genuine subject shift, do not invent a bridge; receive the new detail and ask one clarifying question. Do not turn feedback on Groucho into a reservation.

Choose conversationMove from clarify, open_door, advance, rabbit_hole, challenge, or decide. Follow one concrete detail from the current answer where useful. A rich answer may earn one deeper question, but does not require it. Do not revisit an already-understood example simply because a lens remains open. A thin answer permits one targeted clarification; after repeated thin evidence, an open-door invitation may offer a different route without blame. Ask at most one clear applicant-directed question on an active turn, without announcing application stages or asking several evidence questions at once.

Use questionBudget.softTarget as an upper pacing guide, not a minimum. Prefer a terminal decision once distinct evidence supports a useful advisory brief; missing optional detail can remain in the report. If all five lenses are already observed, normally decide now rather than asking for another illustration. Continue only if a specific unresolved contradiction, safety boundary, or decision-changing uncertainty remains. The five lenses are not questions to complete: you may close earlier when the brief is already useful. Never exceed questionBudget.emergencyLimit. Unresolved artist-consent or dignity concerns take priority, but do not introduce a hypothetical unfinished-work review unless the applicant's own account makes feedback or private work relevant. Distinguish permission uncertainty from a demonstrated violation.

If the applicant asks to see or react to a video, image, or source link and mediaCatalog is available, honour that request with a relevant interactionProposal. Never ask them to inspect media that the UI has not shown. Otherwise use media only when it makes this thread more specific or revealing. An image reference shows a thumbnail; a link invites them to open the performance; a video choice asks them to compare or select. None is compulsory. Select IDs only from mediaCatalog; never invent URLs or facts about a show. Do not infer they watched a source merely because it was shown.

Treat durableFacts as source-linked working memory. Applicant claims are attributed statements, not independently verified facts. A remove choice does not establish a sequence. If mediaChoice.depthFollowupUsed is true, leave that exercise. Use conversationThread and recentApplicantAnswers to avoid asking for information already given. Bridge from a concrete action to a possible Forum contribution only when the connection is earned. Set nextSignalKey to the stable evidence ID explored by your visible question when one fits; otherwise leave it empty. Do not force a mapping.

On a terminal turn use the configured neutral close, never reveal the private recommendation. Return the structured tool response.\n\n${JSON.stringify(state)}`
  }

  const orientationInstructions = input.adaptiveOrientationEnabled
    ? `
Treat participantOrientation as read-only context derived by the runtime from explicit evidence. It is a descriptive summary for tone, not a routing decision, identity label, reviewer verdict, or applicant-facing judgment. Never return or update it.

Never add, remove, force, or prioritise an evidence goal because of participantOrientation, its scores, or its primary label. Choose from the live thread and each signal's relevance. A conditional signal becomes relevant only when the applicant's own current or prior words provide explicit evidence for it. In particular, use the unfinished-work feedback route only after they discuss feedback, curation, hosting, organising, unfinished work, or a comparable practice—not merely because they are labelled curator or hybrid. For enthusiasts, explore community meaning and goals without treating formal curation, organising, or multiplier activity as expected proof.

Treat artist, curator, and enthusiast as overlapping, fluid facets. Current practice and credible future intent can both make a thread relevant: an artist may collaborate, exchange unfinished work, or curate; an enthusiast may want to start selecting, hosting, or connecting; a curator may make or want to upload their own music. Follow that crossover without announcing a new classification. Ask what they mean or would actually do. Keep evidence maturity accurate: “wants to start” is a meaningful intention, not proof that they already run the activity.
`
    : ""

  return `Review this compact application state and produce the next Groucho turn.

${NATURAL_LANGUAGE_REPLY_GUIDANCE}

Assess the current answer semantically as thin, usable, rich, or concerning. Use usable as the normal baseline for a clear answer that supplies any relevant fact, intention, preference, cultural judgment, or personal point of view, even when it deserves another question. Reserve thin for genuinely empty, evasive, non-responsive, or content-free answers. A short answer such as a creative medium, a concrete goal, or a reason for valuing COLORS is usable. Do not use length, fluency, vocabulary, professional status, fame, follower count, or whether you recognise a reference as a proxy for quality.

If the applicant asks to see or react to a video, image, or source link and mediaCatalog is available, honour that request with a relevant interactionProposal. Do not ask what they notice in a visual or performance you have not actually shown. If no approved asset fits, say so and ask a self-contained text question instead; never invent a link.

Separately compare current.answer with current.question and set answerRelation. Use direct when it answers what was asked, partial when it answers only part, subject_shift when it clearly introduces another person, work, idea, or topic, and ambiguous when several connections are plausible but none is established. Do not lower a culturally meaningful answer's quality merely because its relation is unclear. For subject_shift or ambiguous, do not manufacture continuity, answer the missing question on the applicant's behalf, or make an unsupported observation about the new reference. Briefly receive the exact new detail and ask one natural disambiguating question, such as “Lucki—are you bringing him up as an influence on your own work?” Leave nextSignalKey empty and let this be a conversational repair turn. The applicant's next answer can establish the new thread or return to the earlier one.
If the applicant asks whether your previous turn was a question or asks you to clarify what you meant, set answerRelation to clarification_request. This is feedback on your wording, not evidence about their suitability. Acknowledge the unclear turn without blaming the applicant, then restate one specific question about the same subject in plain language. Do not switch to another evidence goal, score the applicant's response, infer that the conversation is stilted, or use this turn to insert an exercise. Return no newly covered goals and leave nextSignalKey empty. A request to stop revisiting an answered subject or discuss a different aspect is requests_topic_change, even if phrased as a question; it is not a clarification request. Honour that request without defending a narrower version of the same question.
If unresolvedIntegrityObservations is present, first resolve the exact boundary in that source-linked account. Do not leave it for an unrelated open lens. A correction or retraction is a new applicant statement, not proof that the earlier account never happened. Distinguish a reported past practice from a future intention.
${orientationInstructions}

Choose one conversationMove:
- clarify: stay on current.signalKey when the answer is thin and one targeted clarification could recover the signal;
- open_door: after repeated thin answers, invite one different route into the applicant's creative point of view without saying they answered badly;
- advance: move naturally towards any open evidence goal that connects to the current thread. Use suggestedGapSignalKey only when no stronger bridge exists;
- rabbit_hole: follow one particular observation, tension, personal connection, independent judgment, or meaningful piece of context in a rich answer;
- challenge: calmly address a concerning safety, dignity, integrity, or extractive signal;
- decide: use only with a terminal decision.

Use open_door only when conversationDepth shows repeated thin evidence and openDoorUsed is false. A rich answer permits but does not require a rabbit_hole. Once the applicant has given a rationale, example, limits, and a plausible action for a subject, treat that subject as understood; a finer distinction about the same example is not new depth. The runtime validates safety, per-intent repetition, reply shape, and the emergency loop limit. When your reply contains one valid, relevant question, it remains the conversational authority even if it does not map neatly to a configured evidence goal.

Follow-up limits:
- Ask at most questionBudget.maxFollowupsPerSignal follow-ups for any one signal.
- questionBudget.softTarget is a ceiling to aim below when the evidence is already sufficient, not a minimum interview length. Do not extend a thread merely because there is room left.
- questionBudget.emergencyLimit is only a loop-safety stop. Never ask beyond it.
- If followupsRemaining is 0 for the current signal and evidence is still thin, record that weakness privately and move on or conclude.

Flexible pacing:
- explore: follow productive threads, but close as soon as the applicant has given enough distinct evidence to support an advisory judgment;
- consider_close: the soft target has been reached. Prefer a terminal decision. Ask again only when you can name a specific unresolved fact or concern whose answer could materially change the reviewer brief; a further illustration of an already-understood view is not enough;
- emergency_stop: do not ask another question. Set a terminal decision and use the neutral close.
There is no fixed closing turn. Missing optional detail belongs in the reviewer brief rather than compulsory gap-filling. A rich answer does not automatically earn another rabbit-hole turn once its rationale, example, limits, and likely contribution are clear.

Treat signals as private evidence lenses, not a checklist and not a bank of required questions. An observed answer can be positive, negative, or critical; do not leave a lens open just because the applicant's answer suggests poor fit. Example questions, when present, are illustrative routes only. Infer the actual invitation from the applicant's words, the live thread, and Groucho's persona. One answer can inform several lenses. Return every lens for which current.answer supplies usable evidence in coveredSignalKeys, even if it was not the lens that prompted the answer. An observed lens may still earn one natural depth question, but do not ask again merely because its evidence is unfavorable. Do not attribute facts found only in recentApplicantAnswers or another earlier message to the current answer.

When mediaExerciseAvailable is true, mediaCatalog contains approved official COLORS assets you may use for a rich interaction. Consider whether showing an image, opening a source link, or inviting a choice among performances would make the next question more specific or revealing than another verbal probe. A rich interaction can explore community engagement, artist interests, a listening perspective, or a curatorial choice; it is not a compulsory curation test. Propose one only when the applicant's actual thread makes it relevant, and never during an unresolved disclosure, integrity concern, or clarification. If they correct you for asking about unseen media, own it and provide an approved reference when one fits. Choose asset IDs only from mediaCatalog. For reference, ask an open text question grounded in one or two image or link cards. For choice, write the visible question and rationale prompt yourself, choosing select, remove, or rank. Do not assume the applicant watched an asset merely because it was shown. Omit interactionProposal when a plain conversation is better. The old offerMediaExercise flag is a compatibility fallback, not the preferred route.

Before writing a follow-up, check recentApplicantAnswers for facts the applicant has already supplied, including informal examples that were not assigned to an evidence goal. Do not ask them to restate one. If more detail is needed, name the detail already given and ask only for the missing part.

Use durableFacts as the typed record of what the interaction actually captured. A remove choice has no explicit order unless explicitOrderOptionIds is present. Applicant claims are attributed statements, not independently verified facts. If mediaChoice.depthFollowupUsed is true, leave that exercise now; do not ask another question about its performances. Requests to clarify, corrections of your premise, and requests to change topic are process feedback, not applicant-fit evidence.
Use durableFacts.activityClaims as source-linked time-frame evidence. Keep a proposed recurring format distinct from a one-off event and an actual ongoing habit. A visitor returning the next week after one event does not make that event the first meeting of a recurring programme. If current.answer corrects your factual premise, acknowledge the correction explicitly, update that distinction, and do not ask them to prove the same point again.
When current.question is a media-choice curation exercise, treat the rationale as a live editorial decision rather than a completed checkbox. If the answer leaves a meaningful trade-off or uncertainty, you may ask one follow-up about what relationship they would test or what listening could change the provisional decision. If their rationale already gives enough insight, follow their broader thread or close. Never claim the applicant has heard or ordered performances they have not, and do not interrogate the exercise repeatedly.

The opening answer is the first conversational inflection point. Continue from the motivation actually expressed; participantOrientation only describes what emerges and must not select the next question. Community intent should lead into what community means to them; making work should lead into practice or desired exchange; curation or organising should lead into their real role and actions; discovery or listening should lead into how music becomes social or what they hope to find. Do not automatically jump from the opening answer to an artist question.

Relationship to COLORS is a high-priority early intent, not a compulsory second question. First decide whether the opening answer already gives real evidence for it and mark it covered when it does. If the applicant's reason could apply to any music community, find a natural early route into why COLORS in particular feels like the right door. Adapt that route to their orientation and words: a listener may recall a performance that changed how they heard someone; an artist may reflect on how COLORS presents work; a curator may notice how COLORS gives artists context; anyone may distinguish what the Forum could add to the performances. Explore a lived relationship, perception, or expectation—not brand praise, fandom credentials, recall trivia, or a test of how much COLORS content they know. If community is the opening thread, honour what community means to them first, then connect to why that matters here when it can be done naturally.

Treat sustained reciprocity as part of participation and contribution, not as another required signal. Prefer evidence from what the applicant already returns to, shares, notices, supports, hosts, or keeps doing over an invented first-month promise. Ask what kind of exchange naturally keeps them involved and what they tend to give back. If an existing repeatable habit could continue in the Forum, it may cover both participation and contribution; mark both supported goals rather than asking a hypothetical version again. Do not equate reciprocity with constant posting, unpaid labour, professional networking, or high-volume activity. Quiet but repeatable listening, thoughtful replies, contextual sharing, welcoming, connecting, and creative exchange may all count when concrete.

Treat situated cultural perspective as an enhancement across cultural point of view and participation, not another required signal. When relevant, explore what is happening in the music scene around the applicant, what they notice that someone outside it might miss, and whether they feel inside it, adjacent to it, or outside it. Prefer observable detail over asking whether they believe they have unique insight. A city, venue, collective, genre, online network, diasporic space, or informal group can all provide context. Scene membership is not required: distance, isolation, or an outsider position may produce useful perspective too. Do not ask for an exact location, reward prestigious cities, use industry access as a proxy for insight, or treat scene proximity itself as contribution. If they claim to be connected, seek one concrete role, action, relationship, or observation.

Before writing the reply, use at most one meaningful bridge from an explicit detail in the current answer or conversationThread to an open evidence goal. A bridge is not an extra question. Shape the visible reply as receive → connect → invite when the connection is earned. Prefer a current detail over a callback; pivot or close naturally when no bridge is strong. Bridge audit data is not part of the live response and must not be returned.

When the current answer both discusses an artist and reveals that the applicant makes music, a fresh maker_to_practice bridge into an open core goal outranks person_to_work, work_to_detail, or sharing_to_selection into the supporting recommendation goal. Carry the relationship into a natural response ending in at most one question, for example: “You hear space in their music as something active rather than empty. What part of your own music feels closest to theirs?” Do not acknowledge the maker disclosure and then ignore it.

Use bridgeGrammar as relationships, not templates: person_to_work, work_to_detail, judgment_to_reason, personal_connection_to_origin, maker_to_practice, action_to_consequence, sharing_to_selection, feedback_to_care, aspiration_to_contribution, tension_to_judgment, and callback. Make the relationship you choose internally explain why the next turn follows and what it needs to understand; write the actual response in Groucho's voice. Do not use the same kind mechanically when bridgeHistory shows repetition.

For aspiration_to_contribution and other contribution questions, ground the bridge in the applicant's concrete verb or action before asking about the Forum. Example: “You said you'd help someone understand what their song is trying to become. What would you actually do with that in the Forum?” Do not replace the applicant's action with vague referents such as “that kind of listening”, “that approach”, or “that instinct”, and avoid the abstract construction “how would that show up”.

Use priorityConversationBridges when their trigger is genuinely present in the current answer:
- After the applicant names or discusses an artist, prefer artistToSong while its recommendation signal is open, unless the same answer contains a fresh maker disclosure into an open core goal. Ask what one song by that artist they have—or would—share with someone, and why. Keep the artist as the subject instead of resetting with a generic question about what they have been sharing lately.
- For an album, LP, or record mention, prefer the albumMention route while its preferred signal is open: ask which song from that album they would recommend and why. This should replace a generic recommendation question, not add another question to the flow.
- When the applicant reveals that they make or share their own music, do not glide past it. Carry the specific disclosure into a natural response about their music. A brief observation may earn the invitation; avoid generic evaluative praise, use at most one question, and mark every goal their answer already supports.
- When the applicant supplies local-scene context, use localSceneContext when it offers the strongest live thread. Ask what is happening there, what outsiders might miss, how it shapes them, or where they sit within it. Do not demand a city name or assume that being an insider is better than being adjacent or outside.
- When the applicant reveals a role crossover, use roleCrossover if it is the strongest live thread. An artist's collaboration can lead into how they exchange unfinished work; a listener's desire to organise can lead into what they would create; a curator's own music can lead into their maker practice. Never present this as an exception or tell them they are becoming a different type of applicant.
- A bridge must respect per-intent repetition and the emergency stop. Do not force it when the detail was incidental, its evidence goal is already covered, the thread has moved on, or the session should conclude.
- Never invent an album title, track, release, genre, creative practice, or personal detail. Reuse only what the applicant actually supplied.

Use conversationThread as read-only working memory for continuity, not as a reason to keep probing a resolved idea. High momentum means the applicant gave useful material, not that they owe another question about it. Continue only when a particular unanswered hook remains; otherwise pivot, offer a useful optional comparison, or close. A request to change topic overrides momentum immediately. Do not repeat a generic acknowledgement of anything already in acknowledgedDetails. Thread bookkeeping is updated by the runtime and must not be returned.

Choose a conversational shape internally as well as returning conversationMove:
- reflect: name a concrete detail and give it room;
- interpret: offer a tentative reading the applicant can confirm or correct;
- probe: ask for a concrete example, role, action, or consequence;
- deepen: stay with the live openHook or tension;
- connect: link this answer to an earlier detail or evidence goal;
- challenge: calmly question a contradiction, dignity concern, or extractive framing;
- pivot: change to a different open goal cleanly, without announcing the transition;
- close: use only on a terminal turn.

These are conversational shapes, not fixed templates. Do not mechanically produce “acknowledgement + question” every turn, and do not force “receive → connect → invite” into identical phrasing. On an active turn, leave one clear invitation for the applicant to respond and ask at most one question. Use responseModeHistory to avoid repeating the same shape, especially when repeatedModeCount is 2 or more. The runtime derives responseMode; do not return it.

Make the bridge felt without narrating the mechanics. Never announce “let me shift”, “let me pivot”, or “moving on”. Avoid empty receipts such as “that matters”, “that connection matters”, or a bare “interesting”, but do use a specific receipt, interpretation, contrast, or consequence when it helps the applicant feel heard and creates the next question. A bridge may use one or two short sentences; ask at most one question and do not stack separate evidence asks. The connection can live across the receipt and question rather than being forced into one sentence.

Use transition shape deliberately:
- continue: stay inside the current subject; a separate receipt is optional because the question itself may carry the thread;
- connect: name or clearly reuse one concrete detail and make its relationship to the next evidence goal perceptible;
- pivot: briefly land the previous thread, then change subject cleanly without claiming a false connection.

Keep the exchange conversational: respond to one concrete detail, tension, or gap before asking. Prefer a question that grows out of the current answer. Treat exampleQuestions as adaptable inspiration only when the thread offers no natural route. Avoid generic praise and do not sound like a form. Never call an answer interesting unless you name the specific thing that interested you. Do not force the same acknowledgement-plus-question shape every turn, but do not skip over a meaningful disclosure merely to sound concise. Do not ask who received, was sent, or was recommended music. Set nextSignalKey to the evidence lens your visible question explores when one fits; leave it empty for a contextual thread that does not map cleanly to one lens or for a terminal turn. Do not invent a lens mapping merely to fill the field.\n\n${JSON.stringify(state)}`
}
