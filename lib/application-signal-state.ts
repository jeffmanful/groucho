import type { ApplicationConversationDepth } from "@/lib/application-conversation-depth"
import {
  EMPTY_APPLICATION_CONVERSATION_THREAD,
  type ApplicationConversationThread,
} from "@/lib/application-conversation-thread"
import type { ApplicationResponseModeHistory } from "@/lib/application-response-mode"
import type { ApplicationBridgeHistory } from "@/lib/application-conversation-bridge"
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
const DEFAULT_MAX_QUESTIONS = 9
const DEFAULT_MAX_FOLLOWUPS_PER_SIGNAL = 2

function evidenceGoal(
  label: string,
): Pick<
  ApplicationSignalDefinition,
  "goal" | "promptRoutes" | "priority" | "cluster"
> {
  const normalized = label.trim().toLowerCase()
  if (normalized.includes("what brought you here")) {
    return {
      goal: "Understand their motivation and relationship to the Forum.",
      promptRoutes: ["What drew you towards this community?", "What are you hoping to find or take part in here?"],
      priority: "supporting",
      cluster: "orientation",
    }
  }
  if (normalized.includes("artist more people should know")) {
    return {
      goal: "Hear a personal cultural point of view through a specific artist or creative reference.",
      promptRoutes: ["Who is making work you think deserves more attention?", "What do people tend to miss about work you care about?"],
      priority: "core",
      cluster: "cultural_point_of_view",
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
    }
  }
  if (normalized.includes("unfinished music")) {
    return {
      goal: "Understand their care, honesty, and judgment when responding to unfinished work.",
      promptRoutes: ["How do you approach feedback when the work is not naturally for you?", "What does useful honesty look like with unfinished work?"],
      priority: "core",
      cluster: "care_and_feedback",
    }
  }
  if (normalized.includes("which sounds most like you")) {
    return {
      goal: "Understand how they currently participate in music culture and community.",
      promptRoutes: ["How do you usually participate around music?"],
      priority: "core",
      cluster: "participation_and_contribution",
    }
  }
  if (normalized.includes("first month") || normalized.includes("contribut")) {
    return {
      goal: "Find one concrete, realistic contribution they could make to the Forum.",
      promptRoutes: ["What might you actually start, share, or help with here?", "What would your participation look like in practice?"],
      priority: "core",
      cluster: "participation_and_contribution",
    }
  }
  return {
    goal: `Understand the applicant's evidence for: ${label.trim()}`,
    promptRoutes: [label.trim()],
    priority: "core",
    cluster: signalKey(label, 0),
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
    return { key, label, ...evidenceGoal(label) }
  })
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
}): string {
  const answersByKey = new Map(input.answers.map((answer) => [answer.key, answer]))
  const suggestedGapSignalKey =
    input.definitions.find((signal) => !previousAnswerCovered(answersByKey.get(signal.key)))?.key ?? null
  const maxQuestions = input.maxQuestions ?? DEFAULT_MAX_QUESTIONS
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
    adaptiveTurnsUsed: input.conversationDepth?.adaptiveTurnsUsed ?? 0,
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
        promptRoutes: signal.promptRoutes ?? evidenceGoal(signal.label).promptRoutes,
        priority: signal.priority ?? evidenceGoal(signal.label).priority,
        cluster: signal.cluster ?? evidenceGoal(signal.label).cluster,
        status: previousAnswerCovered(answer) ? "covered" : "open",
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
      rabbitHoleUsed: false,
      conversationPointsUsed: 0,
      conversationPointsRemaining: 2,
      adaptiveTurnsUsed: 0,
      adaptiveTurnsRemaining: 3,
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
          "Follow the disclosure directly with one question about the music they make: what they are making, what they are trying to express, or what part of their practice connects to the artist they mentioned. Choose one intent only.",
        selectionPriority:
          "When this is a fresh disclosure and a core maker, participation, or contribution goal is open, prefer it over artist-to-song or another supporting recommendation bridge.",
        candidateSignalKeys: ownMusicSignalKeys,
      },
    },
    suggestedGapSignalKey,
  }

  return `Review this compact application state and produce the next Groucho turn.

Assess the current answer semantically as thin, usable, rich, or concerning. A short but specific answer may be usable or rich. Do not use length, fluency, vocabulary, professional status, fame, follower count, or whether you recognise a reference as a proxy for quality.

Choose one conversationMove:
- clarify: stay on current.signalKey when the answer is thin and one targeted clarification could recover the signal;
- open_door: after repeated thin answers, invite one different route into the applicant's creative point of view without saying they answered badly;
- advance: move naturally towards any open evidence goal that connects to the current thread. Use suggestedGapSignalKey only when no stronger bridge exists;
- rabbit_hole: follow one particular observation, tension, personal connection, independent judgment, or meaningful piece of context in a rich answer;
- challenge: calmly address a concerning safety, dignity, integrity, or extractive signal;
- decide: use only with a terminal decision.

An open door or rabbit hole consumes one conversation point. Use open_door only when conversationDepth shows a recent thin answer and openDoorUsed is false. Use rabbit_hole for a rich current answer while conversation points remain. The runtime validates every move.

Follow-up limits:
- Ask at most questionBudget.maxFollowupsPerSignal follow-ups for any one signal.
- Never exceed questionBudget.maxQuestions total applicant-facing questions.
- Clarifications, open doors, and rabbit holes share questionBudget.adaptiveTurnLimit. If adaptiveTurnsRemaining is 0, advance or conclude.
- If followupsRemaining is 0 for the current signal and evidence is still thin, record that weakness privately and move on or conclude.

Pacing phases:
- explore: follow productive threads and gather evidence naturally;
- closing: ask only about an unresolved core goal that could materially affect review;
- final_probe: at most one final question, only for an unresolved core goal with decision-changing value;
- hard_stop: do not ask another question. Set a terminal decision and use the neutral close.
Supporting goals never justify extending the conversation in closing or final_probe. If no core goal warrants another question, conclude. Missing evidence belongs in reviewerReport rather than another attempt.

Treat signals as evidence goals, not a checklist of questions. One answer can cover several goals. Return every goal supported by the current answer in coveredSignalKeys, even if it was not the goal that prompted the answer. Never ask for evidence that is already covered unless a genuine conversational thread warrants one bounded depth question.

Before writing the reply, generate up to three bridgeCandidates from explicit details in the current answer or conversationThread, then select at most one. A bridge joins a source detail to an open evidence goal; it is not an extra question. Rank candidates by continuity, evidence value, specificity, momentum, freshness, and novelty. Prefer a current detail over a callback. Use a callback only when it genuinely makes the conversation cohere. If no candidate is strong, set selectedBridgeIndex to -1 and pivot or close naturally.

When the current answer both discusses an artist and reveals that the applicant makes music, a fresh maker_to_practice bridge into an open core goal outranks person_to_work, work_to_detail, or sharing_to_selection into the supporting recommendation goal. Carry the relationship into one direct question, for example: “What part of your own music feels closest to theirs?” Do not acknowledge the maker disclosure and then ignore it.

Use bridgeGrammar as relationships, not templates: person_to_work, work_to_detail, judgment_to_reason, personal_connection_to_origin, maker_to_practice, action_to_consequence, sharing_to_selection, feedback_to_care, aspiration_to_contribution, tension_to_judgment, and callback. The selected candidate's questionIntent explains what to understand; write the actual question in Groucho's voice from the source detail. Do not use the same kind mechanically when bridgeHistory shows repetition.

Use priorityConversationBridges when their trigger is genuinely present in the current answer:
- After the applicant names or discusses an artist, prefer artistToSong while its recommendation signal is open, unless the same answer contains a fresh maker disclosure into an open core goal. Ask what one song by that artist they have—or would—share with someone, and why. Keep the artist as the subject instead of resetting with a generic question about what they have been sharing lately.
- For an album, LP, or record mention, prefer the albumMention route while its preferred signal is open: ask which song from that album they would recommend and why. This should replace a generic recommendation question, not add another question to the flow.
- When the applicant reveals that they make or share their own music, do not glide past it. Carry the specific disclosure directly into one natural question about their music, without an evaluative preamble. Use an open candidate goal where possible and mark every goal their answer already supports.
- A bridge must use the normal question, adaptive-turn, and closing budgets. Do not force it when the detail was incidental, its evidence goal is already covered, the thread has moved on, or the session should conclude.
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

These are conversational shapes, not fixed templates. Do not mechanically produce “acknowledgement + question” every turn, and do not force “receive, contribute, invite” into identical phrasing. On an active turn, leave one clear invitation for the applicant to respond and ask at most one question. Use responseModeHistory to avoid repeating the same shape, especially when repeatedModeCount is 2 or more.

Render the bridge without narrating it. Never say “that matters”, “that connection matters”, “let me shift”, “let me pivot”, “moving on”, or explain why the next question follows. The connection should be evident from the nouns and verbs in the question itself. Prefer one clean question. Do not stack separate asks such as both “why would you share it?” and “what should they notice?” in the same turn. A short receipt is optional and must add meaning; it is not required before every question.

Keep the exchange conversational: respond to one concrete detail, tension, or gap before asking. Prefer a question that grows out of the current answer. Use promptRoutes only as adaptable inspiration when the thread offers no natural route. Avoid generic praise and do not sound like a form. Never call an answer interesting unless you name the specific thing that interested you. Do not ask who received, was sent, or was recommended music. Set nextSignalKey to current.signalKey for clarify, open_door, rabbit_hole, or challenge; for advance choose any open signal that connects naturally, falling back to suggestedGapSignalKey; use an empty string on terminal turns.\n\n${JSON.stringify(state, null, 2)}`
}
