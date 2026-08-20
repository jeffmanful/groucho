import type { ApplicationConversationDepth } from "@/lib/application-conversation-depth"
import {
  EMPTY_APPLICATION_CONVERSATION_THREAD,
  type ApplicationConversationThread,
} from "@/lib/application-conversation-thread"
import type { ApplicationResponseModeHistory } from "@/lib/application-response-mode"
import type { ApplicationBridgeHistory } from "@/lib/application-conversation-bridge"
import {
  EMPTY_APPLICATION_PARTICIPANT_ORIENTATION,
  orientationHasCuratorRoute,
  type ApplicationParticipantOrientationState,
} from "@/lib/application-participant-orientation"
import {
  applicationQuestionBudget,
  type ApplicationQuestionBudget,
} from "@/lib/application-question-budget"

export type ApplicationSignalDefinition = {
  key: string
  /** Original project configuration, retained for backwards compatibility. */
  label: string
  /** Private evidence goal. This is not a question Groucho must ask verbatim. */
  goal: string
  /** Optional routes Groucho can adapt when the conversation needs a new opening. */
  promptRoutes: string[]
  priority: "core" | "supporting"
  cluster: string
  /** Applicant orientations for which this evidence goal is relevant. */
  audiences: Array<"shared" | "artist" | "curator" | "enthusiast">
}

export type ApplicationSignalAnswer = ApplicationSignalDefinition & {
  answer: string
  /** False means the goal was attempted but the answer did not yet cover it. */
  covered?: boolean
}

export type ApplicationSignalMessage = {
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

const COLORS_RELATIONSHIP_SIGNAL: ApplicationSignalDefinition = {
  key: "colors_relationship",
  label: "Relationship to COLORS",
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
  "goal" | "promptRoutes" | "priority" | "cluster" | "audiences"
> {
  const normalized = label.trim().toLowerCase()
  if (
    normalized.includes("relationship to colors") ||
    normalized.includes("why colors") ||
    normalized.includes("colors specifically")
  ) {
    return {
      goal: COLORS_RELATIONSHIP_SIGNAL.goal,
      promptRoutes: [...COLORS_RELATIONSHIP_SIGNAL.promptRoutes],
      priority: COLORS_RELATIONSHIP_SIGNAL.priority,
      cluster: COLORS_RELATIONSHIP_SIGNAL.cluster,
      audiences: [...COLORS_RELATIONSHIP_SIGNAL.audiences],
    }
  }
  if (normalized.includes("what brought you here")) {
    return {
      goal: "Understand their motivation and relationship to the Forum.",
      promptRoutes: ["What drew you towards this community?", "What are you hoping to find or take part in here?"],
      priority: "supporting",
      cluster: "orientation",
      audiences: ["shared"],
    }
  }
  if (normalized.includes("artist more people should know")) {
    return {
      goal: "Hear a personal cultural point of view through a specific artist or creative reference.",
      promptRoutes: ["Who is making work you think deserves more attention?", "What do people tend to miss about work you care about?"],
      priority: "core",
      cluster: "cultural_point_of_view",
      audiences: ["shared"],
    }
  }
  if (normalized.includes("last song") && normalized.includes("recommend")) {
    return {
      goal: "Understand how and why they discover, contextualise, and share creative work.",
      promptRoutes: [
        "What is one of their songs that you have—or would—share with someone, and why?",
        "When you pass music on, what makes it feel worth someone else's attention?",
      ],
      priority: "supporting",
      cluster: "cultural_point_of_view",
      audiences: ["shared"],
    }
  }
  if (normalized.includes("unfinished music")) {
    return {
      goal: "Understand their care, honesty, and judgment when responding to unfinished work.",
      promptRoutes: ["How do you approach feedback when the work is not naturally for you?", "What does useful honesty look like with unfinished work?"],
      priority: "core",
      cluster: "care_and_feedback",
      audiences: ["curator"],
    }
  }
  if (normalized.includes("which sounds most like you")) {
    return {
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
  const clusters = new Set(definitions.map((signal) => signal.cluster))
  return (
    clusters.has("orientation") &&
    clusters.has("cultural_point_of_view") &&
    clusters.has("care_and_feedback") &&
    clusters.has("participation_and_contribution")
  )
}

export function applicationOpeningMessageForSignals(
  configuredOpening: string,
  definitions: ApplicationSignalDefinition[],
): string {
  return isColorsForumSignalSet(definitions)
    ? COLORS_FORUM_OPENING_QUESTION
    : configuredOpening
}

function orientedPromptRoutes(
  signal: ApplicationSignalDefinition,
  orientation: ApplicationParticipantOrientationState,
): string[] {
  const branch = orientation.primary
  if (branch === "unknown") return signal.promptRoutes

  if (signal.cluster === "colors_relationship") {
    if (branch === "artist") {
      return [
        "Has COLORS changed how you think about presenting or sharing your own work?",
        "What could the Forum add to your relationship with COLORS as an artist?",
      ]
    }
    if (branch === "curator") {
      return [
        "What do you think COLORS gets right about giving work context—and what could the Forum add?",
        "Where does the way COLORS introduces artists connect with the role you already play around music?",
      ]
    }
    if (branch === "enthusiast") {
      return [
        "Is there a COLORS performance that changed how you heard an artist?",
        "What does COLORS give you as a listener that you would want the Forum to carry forward?",
      ]
    }
    return [
      "Which part of your relationship with COLORS are you hoping the Forum carries forward?",
    ]
  }

  if (signal.cluster === "orientation") {
    if (branch === "artist") {
      return [
        "What are you making at the moment, and what are you hoping a community around music could give that work?",
      ]
    }
    if (branch === "curator") {
      return [
        "What role do you already play around music, and what are you hoping the Forum would let you do more meaningfully?",
      ]
    }
    if (branch === "enthusiast") {
      return [
        "What are you hoping to discover or understand here that you are not finding elsewhere?",
      ]
    }
    return [
      "You seem to relate to music in more than one way. Which part of that are you hoping to bring into the Forum?",
    ]
  }

  if (
    signal.cluster === "participation_and_contribution" &&
    signal.label.toLowerCase().includes("which sounds most like you")
  ) {
    if (branch === "artist") {
      return [
        "Outside making the work itself, what kind of exchange with other artists or listeners is useful to you?",
        "What do you naturally offer back when another artist gives your work real attention?",
        "What is happening around music where you are that is shaping the work you make?",
      ]
    }
    if (branch === "curator") {
      return [
        "What do you actually do around music now—select, organise, introduce, document, host, or something else?",
        "What do people already rely on you to keep doing around music?",
        "What part of the music scene around you do you understand from the inside?",
      ]
    }
    if (branch === "enthusiast") {
      return [
        "Where does music become social for you now, even informally?",
        "When a music space keeps you coming back, how do you tend to take part?",
        "Do you feel inside the music scene around you, adjacent to it, or mostly looking in from outside?",
      ]
    }
    return [
      "How do the different parts of your relationship to music show up around other people?",
      "What are you noticing in the music scene around you that someone outside it might miss?",
    ]
  }

  if (signal.cluster === "participation_and_contribution") {
    if (branch === "artist") {
      return [
        "What part of the exchange you already have with other artists or listeners would you want to keep building here?",
        "What would you actually share or do with other artists here during your first month?",
      ]
    }
    if (branch === "curator") {
      return [
        "Which part of what you already do around music could you keep contributing here?",
        "What would you realistically start, share, organise, or connect in your first month here?",
      ]
    }
    if (branch === "enthusiast") {
      return [
        "When a music space keeps you coming back, what do you naturally give to it?",
        "What would you actually share, notice, or do here during your first month?",
      ]
    }
    return [
      "Across the different roles you described, what do you already keep giving—and which part could continue in the Forum?",
    ]
  }

  return signal.promptRoutes
}

export function applicationSignalDefinitionsForOrientation(
  definitions: ApplicationSignalDefinition[],
  orientation: ApplicationParticipantOrientationState,
): ApplicationSignalDefinition[] {
  if (!isColorsForumSignalSet(definitions)) return definitions
  return definitions
    .filter(
      (signal) =>
        signal.audiences.includes("shared") ||
        (signal.audiences.includes("curator") &&
          orientationHasCuratorRoute(orientation)) ||
        (signal.audiences.includes("artist") &&
          orientation.scores.artist >= 0.5) ||
        (signal.audiences.includes("enthusiast") &&
          orientation.scores.enthusiast >= 0.5),
    )
    .map((signal) => ({
      ...signal,
      promptRoutes: orientedPromptRoutes(signal, orientation),
    }))
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
  field: "application_signal" | "application_signals" | "application_next_signal",
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

export function collectApplicationSignalAnswers(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
): ApplicationSignalAnswer[] {
  const answers = new Map<string, ApplicationSignalAnswer>()
  for (const message of messages) {
    if (message.role !== "user") continue
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
      const previous = answers.get(signal.key)?.answer
      const combined = previous ? `${previous}\nFollow-up: ${answer}` : answer
      answers.set(signal.key, {
        ...signal,
        answer: combined.slice(0, MAX_COMPACT_ANSWER_LENGTH),
        covered: hasCoverage
          ? coveredSignals.some((covered) => covered.key === signal.key) || previousAnswerCovered(answers.get(signal.key))
          : true,
      })
    }
  }
  return definitions.flatMap((signal) => {
    const answer = answers.get(signal.key)
    return answer ? [answer] : []
  })
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

export function hasLegacyUntaggedAnswers(
  messages: ApplicationSignalMessage[],
  definitions: ApplicationSignalDefinition[],
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      signalsFromMetadata(message.metadata, "application_signals", definitions).length === 0 &&
      signalsFromMetadata(message.metadata, "application_signal", definitions).length === 0,
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
    requestedSignal = signalsFromMetadata(
      message.metadata,
      "application_next_signal",
      definitions,
    )[0] ?? null
    break
  }
  if (requestedSignal) return requestedSignal
  const answered = new Set(answers.filter(previousAnswerCovered).map((answer) => answer.key))
  return definitions.find((signal) => !answered.has(signal.key)) ?? null
}

export function withCurrentSignalAnswer(
  answers: ApplicationSignalAnswer[],
  signal: ApplicationSignalDefinition | null,
  currentAnswer: string,
  covered = true,
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
    covered: covered || previousAnswerCovered(answers.find((answer) => answer.key === signal.key)),
  })
  return next
}

export function withCoveredSignalAnswers(
  answers: ApplicationSignalAnswer[],
  signals: ApplicationSignalDefinition[],
  currentAnswer: string,
): ApplicationSignalAnswer[] {
  if (!currentAnswer.trim() || signals.length === 0) return answers
  const marked = markCoveredSignals(answers, signals)
  return signals.reduce((next, signal) => {
    if (next.some((answer) => answer.key === signal.key)) return next
    return withCurrentSignalAnswer(next, signal, currentAnswer, true)
  }, marked)
}

export function markCoveredSignals(
  answers: ApplicationSignalAnswer[],
  signals: ApplicationSignalDefinition[],
): ApplicationSignalAnswer[] {
  const coveredKeys = new Set(signals.map((signal) => signal.key))
  return answers.map((answer) =>
    coveredKeys.has(answer.key) ? { ...answer, covered: true } : answer,
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
): ApplicationSignalDefinition | null {
  const answered = new Set(answers.filter(previousAnswerCovered).map((answer) => answer.key))
  const nextMissing = definitions.find((signal) => !answered.has(signal.key)) ?? null
  if (requestedKey) {
    const requested = definitions.find((signal) => signal.key === requestedKey)
    if (requested && (requested.key === currentSignal?.key || !answered.has(requested.key))) {
      return requested
    }
  }
  return nextMissing ?? currentSignal ?? null
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
  conversationDepth?: ApplicationConversationDepth
  conversationThread?: ApplicationConversationThread
  responseModeHistory?: ApplicationResponseModeHistory
  bridgeHistory?: ApplicationBridgeHistory
  questionBudget?: ApplicationQuestionBudget
  participantOrientation?: ApplicationParticipantOrientationState
  adaptiveOrientationEnabled?: boolean
  insufficientEvidenceKeys?: Set<string>
}): string {
  const answersByKey = new Map(input.answers.map((answer) => [answer.key, answer]))
  const orientation =
    input.participantOrientation ??
    EMPTY_APPLICATION_PARTICIPANT_ORIENTATION
  const earlyColorsRelationship =
    input.currentSignal?.cluster === "orientation"
      ? input.definitions.find(
          (signal) =>
            signal.cluster === "colors_relationship" &&
            !previousAnswerCovered(answersByKey.get(signal.key)),
        )
      : null
  const suggestedGapSignalKey =
    earlyColorsRelationship?.key ??
    (input.adaptiveOrientationEnabled === true && orientation.primary === "unknown"
      ? input.definitions.find(
          (signal) =>
            signal.label.toLowerCase().includes("which sounds most like you") &&
            !previousAnswerCovered(answersByKey.get(signal.key)),
        )
      : null)?.key ??
    input.definitions.find(
      (signal) => !previousAnswerCovered(answersByKey.get(signal.key)),
    )?.key ??
    null
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
    input.definitions.find((signal) => {
      const label = signal.label.toLowerCase()
      return label.includes("recommend") && /\b(song|music)\b/.test(label)
    })?.key ?? null
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
  const state = {
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
        evidenceGoal: signal.goal ?? evidenceGoal(signal.label).goal,
        exampleQuestions:
          signal.promptRoutes ?? evidenceGoal(signal.label).promptRoutes,
        priority: signal.priority ?? evidenceGoal(signal.label).priority,
        cluster: signal.cluster ?? evidenceGoal(signal.label).cluster,
        status: previousAnswerCovered(answer)
          ? "covered"
          : input.insufficientEvidenceKeys?.has(signal.key)
            ? "insufficient_evidence"
            : "open",
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
            return { attempts, followupCount, followupsRemaining }
          })()
        : {}),
    },
    conversationDepth: input.conversationDepth ?? {
      recentQualities: [],
      thinAnswerCount: 0,
      richAnswerCount: 0,
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
          orientationBranches: {
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
      "feedback_to_care",
      "aspiration_to_contribution",
      "tension_to_judgment",
      "callback",
    ],
    priorityConversationBridges: {
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
    },
    suggestedGapSignalKey,
  }

  const orientationInstructions = input.adaptiveOrientationEnabled
    ? `
Update participantOrientation from explicit evidence in the current answer and prior state before choosing the next goal. This is a revisable routing hypothesis, not an identity label or applicant-facing judgment. Artist means they make or perform work; curator means they select, organise, contextualise, host, document, or connect people around music; enthusiast means listening, discovery, fandom, discussion, or community-seeking is their main relationship. Use hybrid only when at least two orientations have meaningful evidence. Never infer protected traits, status, or cultural worth.

Tailor the route to the strongest supported orientation. Shared values do not require identical questions. Only use the evidence goals present in signals; branch-inapplicable goals have already been removed. In particular, do not ask artists or enthusiasts the unfinished-work feedback scenario unless their own answer makes feedback or curation genuinely relevant. For enthusiasts, explore community meaning and goals rather than treating formal curation, organising, or multiplier activity as expected proof.
`
    : ""

  return `Review this compact application state and produce the next Groucho turn.

Assess the current answer semantically as thin, usable, rich, or concerning. A short but specific answer may be usable or rich. Do not use length, fluency, vocabulary, professional status, fame, follower count, or whether you recognise a reference as a proxy for quality.
${orientationInstructions}

Choose one conversationMove:
- clarify: stay on current.signalKey when the answer is thin and one targeted clarification could recover the signal;
- open_door: after repeated thin answers, invite one different route into the applicant's creative point of view without saying they answered badly;
- advance: move naturally towards any open evidence goal that connects to the current thread. Use suggestedGapSignalKey only when no stronger bridge exists;
- rabbit_hole: follow one particular observation, tension, personal connection, independent judgment, or meaningful piece of context in a rich answer;
- challenge: calmly address a concerning safety, dignity, integrity, or extractive signal;
- decide: use only with a terminal decision.

Use open_door only when conversationDepth shows repeated thin evidence and openDoorUsed is false. Use rabbit_hole for a rich current answer when the live thread can still add relevant understanding. The runtime validates per-intent repetition and emergency-loop limits.

Follow-up limits:
- Ask at most questionBudget.maxFollowupsPerSignal follow-ups for any one signal.
- questionBudget.softTarget is a pacing prompt, not a deadline. Do not distort a live thread to meet it.
- questionBudget.emergencyLimit is only a loop-safety stop. Never ask beyond it.
- If followupsRemaining is 0 for the current signal and evidence is still thin, record that weakness privately and move on or conclude.

Flexible pacing:
- explore: follow productive threads and gather evidence naturally;
- consider_close: the soft target has been reached. Ask another question only when it grows naturally from the live thread or would materially improve the reviewer brief; otherwise conclude;
- emergency_stop: do not ask another question. Set a terminal decision and use the neutral close.
There is no closing phase at answers seven or eight. Missing evidence belongs in reviewerReport rather than compulsory gap-filling.

Treat signals as private evidence intents, not a checklist and not a bank of required questions. exampleQuestions are illustrative routes only. Infer the actual question from the applicant's words, the live thread, the relevant unresolved intent, and Groucho's persona. Do not copy an example merely because its signal is open. One answer can cover several goals. Return every goal supported by the current answer in coveredSignalKeys, even if it was not the goal that prompted the answer. Never ask for evidence that is already covered unless a genuine conversational thread warrants one bounded depth question.

The opening answer is the first routing inflection point. Use it to form a revisable participantOrientation and continue from the motivation actually expressed. Community intent should lead into what community means to them; making work should lead into practice or desired exchange; curation or organising should lead into their real role and actions; discovery or listening should lead into how music becomes social or what they hope to find. Do not automatically jump from the opening answer to an artist question.

Relationship to COLORS is a high-priority early intent, not a compulsory second question. First decide whether the opening answer already gives real evidence for it and mark it covered when it does. If the applicant's reason could apply to any music community, find a natural early route into why COLORS in particular feels like the right door. Adapt that route to their orientation and words: a listener may recall a performance that changed how they heard someone; an artist may reflect on how COLORS presents work; a curator may notice how COLORS gives artists context; anyone may distinguish what the Forum could add to the performances. Explore a lived relationship, perception, or expectation—not brand praise, fandom credentials, recall trivia, or a test of how much COLORS content they know. If community is the opening thread, honour what community means to them first, then connect to why that matters here when it can be done naturally.

Treat sustained reciprocity as part of participation and contribution, not as another required signal. Prefer evidence from what the applicant already returns to, shares, notices, supports, hosts, or keeps doing over an invented first-month promise. Ask what kind of exchange naturally keeps them involved and what they tend to give back. If an existing repeatable habit could continue in the Forum, it may cover both participation and contribution; mark both supported goals rather than asking a hypothetical version again. Do not equate reciprocity with constant posting, unpaid labour, professional networking, or high-volume activity. Quiet but repeatable listening, thoughtful replies, contextual sharing, welcoming, connecting, and creative exchange may all count when concrete.

Treat situated cultural perspective as an enhancement across cultural point of view and participation, not another required signal. When relevant, explore what is happening in the music scene around the applicant, what they notice that someone outside it might miss, and whether they feel inside it, adjacent to it, or outside it. Prefer observable detail over asking whether they believe they have unique insight. A city, venue, collective, genre, online network, diasporic space, or informal group can all provide context. Scene membership is not required: distance, isolation, or an outsider position may produce useful perspective too. Do not ask for an exact location, reward prestigious cities, use industry access as a proxy for insight, or treat scene proximity itself as contribution. If they claim to be connected, seek one concrete role, action, relationship, or observation.

Before writing the reply, generate up to three bridgeCandidates from explicit details in the current answer or conversationThread, then select at most one. A bridge joins a source detail to an open evidence goal; it is not an extra question. For each candidate, privately plan receive → connect → invite: preserve the concrete source detail, describe in connectionIntent the meaningful relationship that earns the next question, then state the questionIntent. Rank candidates by continuity, evidence value, specificity, momentum, freshness, and novelty. Prefer a current detail over a callback. Use a callback only when it genuinely makes the conversation cohere. If no candidate is strong, set selectedBridgeIndex to -1 and pivot or close naturally.

When the current answer both discusses an artist and reveals that the applicant makes music, a fresh maker_to_practice bridge into an open core goal outranks person_to_work, work_to_detail, or sharing_to_selection into the supporting recommendation goal. Carry the relationship into a natural response ending in at most one question, for example: “You hear space in their music as something active rather than empty. What part of your own music feels closest to theirs?” Do not acknowledge the maker disclosure and then ignore it.

Use bridgeGrammar as relationships, not templates: person_to_work, work_to_detail, judgment_to_reason, personal_connection_to_origin, maker_to_practice, action_to_consequence, sharing_to_selection, feedback_to_care, aspiration_to_contribution, tension_to_judgment, and callback. The selected candidate's connectionIntent explains why the next turn follows and questionIntent explains what to understand; write the actual response in Groucho's voice from both. Do not use the same kind mechanically when bridgeHistory shows repetition.

For aspiration_to_contribution and other contribution questions, ground the bridge in the applicant's concrete verb or action before asking about the Forum. Example: “You said you'd help someone understand what their song is trying to become. What would you actually do with that in the Forum?” Do not replace the applicant's action with vague referents such as “that kind of listening”, “that approach”, or “that instinct”, and avoid the abstract construction “how would that show up”.

Use priorityConversationBridges when their trigger is genuinely present in the current answer:
- After the applicant names or discusses an artist, prefer artistToSong while its recommendation signal is open, unless the same answer contains a fresh maker disclosure into an open core goal. Ask what one song by that artist they have—or would—share with someone, and why. Keep the artist as the subject instead of resetting with a generic question about what they have been sharing lately.
- For an album, LP, or record mention, prefer the albumMention route while its preferred signal is open: ask which song from that album they would recommend and why. This should replace a generic recommendation question, not add another question to the flow.
- When the applicant reveals that they make or share their own music, do not glide past it. Carry the specific disclosure into a natural response about their music. A brief observation may earn the invitation; avoid generic evaluative praise, use at most one question, and mark every goal their answer already supports.
- When the applicant supplies local-scene context, use localSceneContext when it offers the strongest live thread. Ask what is happening there, what outsiders might miss, how it shapes them, or where they sit within it. Do not demand a city name or assume that being an insider is better than being adjacent or outside.
- A bridge must respect per-intent repetition and the emergency stop. Do not force it when the detail was incidental, its evidence goal is already covered, the thread has moved on, or the session should conclude.
- Never invent an album title, track, release, genre, creative practice, or personal detail. Reuse only what the applicant actually supplied.

Use conversationThread as working memory for continuity. If its momentum is high or medium and the current answer keeps the openHook or strongestDetail alive, continue that thread before filling an unrelated goal. Connect the next reply to what was actually said, and do not repeat a generic acknowledgement of anything already in acknowledgedDetails. Pivot when momentum is low or exhausted, the hook is resolved, the relevant depth/follow-up budget is unavailable, or an important gap must be checked near the end. Update threadState for the reply you produce.

Choose a responseMode as well as a conversationMove:
- reflect: name a concrete detail and give it room;
- interpret: offer a tentative reading the applicant can confirm or correct;
- probe: ask for a concrete example, role, action, or consequence;
- deepen: stay with the live openHook or tension;
- connect: link this answer to an earlier detail or evidence goal;
- challenge: calmly question a contradiction, dignity concern, or extractive framing;
- pivot: change to a different open goal cleanly, without announcing the transition;
- close: use only on a terminal turn.

These are conversational shapes, not fixed templates. Do not mechanically produce “acknowledgement + question” every turn, and do not force “receive → connect → invite” into identical phrasing. On an active turn, leave one clear invitation for the applicant to respond and ask at most one question. Use responseModeHistory to avoid repeating the same shape, especially when repeatedModeCount is 2 or more.

Make the bridge felt without narrating the mechanics. Never announce “let me shift”, “let me pivot”, or “moving on”. Avoid empty receipts such as “that matters”, “that connection matters”, or a bare “interesting”, but do use a specific receipt, interpretation, contrast, or consequence when it helps the applicant feel heard and creates the next question. A bridge may use one or two short sentences; ask at most one question and do not stack separate evidence asks. The connection can live across the receipt and question rather than being forced into one sentence.

Use transition shape deliberately:
- continue: stay inside the current subject; a separate receipt is optional because the question itself may carry the thread;
- connect: name or clearly reuse one concrete detail and make its relationship to the next evidence goal perceptible;
- pivot: briefly land the previous thread, then change subject cleanly without claiming a false connection.

Keep the exchange conversational: respond to one concrete detail, tension, or gap before asking. Prefer a question that grows out of the current answer. Treat exampleQuestions as adaptable inspiration only when the thread offers no natural route. Avoid generic praise and do not sound like a form. Never call an answer interesting unless you name the specific thing that interested you. Do not force the same acknowledgement-plus-question shape every turn, but do not skip over a meaningful disclosure merely to sound concise. Do not ask who received, was sent, or was recommended music. Set nextSignalKey to the private evidence intent your visible question is exploring; use current.signalKey for clarify, open_door, rabbit_hole, or challenge, choose any relevant open signal for advance, and use an empty string on terminal turns.\n\n${JSON.stringify(state, null, 2)}`
}
