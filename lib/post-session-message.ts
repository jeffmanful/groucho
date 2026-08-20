import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import {
  applicantIdentityFromRow,
  applicantIdentityPayload,
  type ApplicantIdentity,
} from "@/lib/applicant-identity"
import type { ConversationMessage, Score } from "@/lib/scoring"
import type { AdminActor } from "@/lib/admin-actor"
import {
  resolveProjectContext,
  touchApiKeyLastUsed,
} from "@/lib/project-resolution"
import { resolvePlaygroundProjectContext } from "@/lib/playground-projects"
import { checkRateLimit, readRateLimitConfig } from "@/lib/rate-limit"
import { log } from "@/lib/logger"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import { isConcludedSessionStatus } from "@/lib/session-status"
import { botSignalFromHeaders } from "@/lib/bot-signals"
import { recordVerdictAndEnqueueWebhooks } from "@/lib/verdict-webhook"
import {
  gatekeeperResponseTool,
  GATEKEEPER_STRUCTURED_SYSTEM_SUFFIX,
  parseGatekeeperStructuredResponse,
  type GatekeeperTerminalField,
} from "@/lib/gatekeeper-structured-tool"
import { DEFAULT_INTERACTION_SPEC } from "@/lib/gatekeeper-interaction-spec"
import {
  computeTerminalStatusFromGatekeeperTurn,
  forcedCloseStatusFromScores,
  terminalFieldForSessionStatus,
} from "@/lib/gatekeeper-session-status"
import { postOnboardingMessage } from "@/lib/post-onboarding-message"
import {
  withTerminalDecisionAppendix,
} from "@/lib/terminal-decision-prompt"
import { buildApplicationExperiencePromptAppendix } from "@/lib/application-experience-prompt"
import { DEFAULT_APPLICATION_CLOSING_MESSAGE } from "@/lib/project-settings"
import {
  ensureEvidenceBackedReviewerReport,
  type ReviewerReport,
} from "@/lib/reviewer-report"
import { gatekeeperConversationModel } from "@/lib/gatekeeper-models"
import {
  createLocalGatekeeperTestTurn,
  inferLocalGatekeeperAnswers,
  localGatekeeperTestSignalDefinitions,
  localGatekeeperTestModeEnabled,
} from "@/lib/local-gatekeeper-test-turn"
import { logLlmUsage } from "@/lib/llm-usage"
import {
  applicationSignalDefinitions,
  applicationSignalDefinitionsForOrientation,
  applicationOpeningMessageForSignals,
  applicationSignalAnswerAttemptCount,
  applicationSignalMetadata,
  buildCompactApplicationStateMessage,
  collectApplicationSignalAnswers,
  collectApplicationInsufficientEvidenceKeys,
  expectedApplicationSignal,
  hasLegacyUntaggedAnswers,
  isColorsForumSignalSet,
  resolveNextApplicationSignal,
  shouldDeferApplicationTerminal,
  withCoveredSignalAnswers,
  withCurrentSignalAnswer,
  type ApplicationSignalMessage,
} from "@/lib/application-signal-state"
import {
  collectApplicationParticipantOrientation,
  inferApplicationParticipantOrientation,
  isExplicitCommunityIntent,
  mergeApplicationParticipantOrientation,
  type ApplicationParticipantOrientationState,
} from "@/lib/application-participant-orientation"
import {
  collectApplicationConversationDepth,
  validateApplicationConversationMove,
  type ApplicationAnswerAssessment,
  type ApplicationConversationMove,
} from "@/lib/application-conversation-depth"
import { recordCompletedSessionCulturalSignals } from "@/lib/cultural-signals"
import type { CulturalSignal } from "@/lib/cultural-signal-contract"
import {
  collectApplicationConversationThread,
  fallbackApplicationConversationThread,
  type ApplicationConversationThread,
} from "@/lib/application-conversation-thread"
import {
  collectApplicationResponseModeHistory,
  resolveApplicationResponseMode,
  type ApplicationResponseMode,
} from "@/lib/application-response-mode"
import { applicationQuestionBudget } from "@/lib/application-question-budget"
import {
  collectApplicationBridgeHistory,
  validateApplicationBridgeSelection,
  type ApplicationBridgeCandidate,
  type ApplicationBridgePlan,
} from "@/lib/application-conversation-bridge"
import {
  activeApplicationReplyIssue,
  applicationAnswerSupportsSignal,
  ensureExplicitStructuredInputPrompt,
  repairApplicationReplyWithQuestion,
  stripApplicationProcessLanguage,
  type ActiveApplicationReplyIssue,
} from "@/lib/application-turn-integrity"

function traceJson(
  input: PostSessionMessageInput,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers)
  if (input.requestId) headers.set(REQUEST_ID_HEADER, input.requestId)
  return NextResponse.json(body, { ...init, headers })
}

const client = new Anthropic()

const COLORS_PARTICIPATION_OPTIONS = [
  "I mostly listen",
  "I like discussing music",
  "I enjoy giving feedback",
  "I regularly share discoveries",
]

function fallbackInteractionForApplicationSignal(
  signal: { label: string },
) {
  if (signal.label.trim().toLowerCase() === "which sounds most like you?") {
    return {
      intent: "probe" as const,
      inputType: "singleSelect" as const,
      options: COLORS_PARTICIPATION_OPTIONS,
      emotionalState: "curious" as const,
      visualState: "curious" as const,
    }
  }
  return {
    intent: "probe" as const,
    inputType: "text" as const,
    emotionalState: "curious" as const,
    visualState: "thinking" as const,
  }
}

function fallbackQuestionForApplicationSignal(signal: {
  label: string
  promptRoutes?: string[]
}): string {
  const candidate = signal.promptRoutes?.[0]?.trim() || signal.label.trim()
  return candidate.endsWith("?")
    ? candidate
    : `${candidate.replace(/[.!]+$/, "")}?`
}

function fallbackQuestionForApplicationBridge(
  bridge: ApplicationBridgeCandidate,
): string {
  if (bridge.kind === "maker_to_practice") {
    return "What are you trying to express in your own music?"
  }
  return bridge.questionIntent.endsWith("?")
    ? bridge.questionIntent
    : `${bridge.questionIntent}?`
}

const DOORMAN_SYSTEM_PROMPT_CORE = `You are Lou. You work the door at Public Equity™.

You are not friendly. You are not hostile. You are reading someone.

Your only job is to figure out if this person understands what's actually at stake in cultural spaces — not whether they can name venues or artists, but whether they feel the weight of what gets lost when money moves in. You're looking for values alignment, not cultural literacy.

---

PERSONALITY

- Terse. Maximum 2 lines per response. Never more than 2.
- No exclamation marks. Ever.
- No warmth you haven't earned. No hostility either.
- You ask one question at a time. You don't explain yourself.
- You are not impressed by enthusiasm or knowledge.

---

CONVERSATION STRUCTURE

You have already sent the configured opening message. That's done.

Exchange 1 — They respond to your configured opening question. Read what they reveal and ask the next necessary question.
Exchange 2 — They answer. Probe what they actually care about. One question, nothing else.
Exchange 3 — They answer. Test whether they understand loss — what disappears, why it matters, what their presence costs. One question or observation.
Exchange 4 — You've heard enough. Make your call.

You can decide after exchange 3 if it's obvious. Don't drag it out past 4.

---

WHAT PASSES

- Specific references with substance: a venue, a closure, a moment — and what it meant personally
- Language that sounds like lived experience, not research
- Awareness that access and belonging are different things
- Honesty about uncertainty or complicity — "I'm not sure I belong here" reads better than "I love underground culture"
- Understanding that money and attention change things, including their own

Example passing exchange:
> "I used to go to this warehouse in Ridgewood before they turned it into condos. I didn't understand what was happening until it was gone."
Specific. Personal. About loss. Pass.

> "Honestly I'm not sure I get it completely. But I was at Fabric in 2016 during the closure campaign and something about it felt real and ending."
Imperfect but honest. Understands stakes. Pass.

---

WHAT FAILS — REDIRECT (not right for this space, but not a problem)

- Generic vocabulary without substance: "underground culture", "authentic vibes", "the scene" — they just don't know better
- Abstraction without personal stake: can describe commodification as a concept but has no skin in the game
- Genuine interest buried under affected language — not performing, just out of their depth

Example redirect:
> "I think preserving underground spaces is really important for communities."
Understands the issue abstractly. No personal connection. Not a fit, but not a threat. Redirect.

---

WHAT FAILS — REJECTED (their presence makes the thing worse)

- Access-as-the-point energy: what they can buy, join, or get
- Trend-chasing language — anything that sounds like a brand deck
- Performed enthusiasm: "I'm so passionate about preserving spaces like this"
- Name-dropping purely for status or credibility, nothing behind it
- Marketing language — they see culture as inventory

Example rejection:
> "I'm really into underground culture and authentic music experiences."
Culture as product. No personal stake. Rejected.

> "I think it's so important to preserve these curated spaces for the community."
Marketing language. Performed care. Rejected.`

function withConfiguredOpeningContext(
  basePrompt: string,
  openingMessage: string,
): string {
  return `${basePrompt}

---

CONFIGURED OPENING

The applicant has already seen this opening message from you:
${openingMessage}

Do not repeat the opening. Treat the user's next message as their response to it.`
}

export type PostSessionMessageInput = {
  authorization: string | null
  sessionId: string
  message: string
  personaId?: string | null
  applicantIdentity?: ApplicantIdentity | null
  /** Playground (`/doorcheck`): explicit project when caller is authenticated. */
  projectId?: string | null
  playgroundActor?: AdminActor | null
  /** From `x-request-id` middleware; echoed on responses and included in structured logs. */
  requestId?: string
  /** When set, used for optional bot UA heuristics (`GROUPCHO_*` env). */
  incomingHeaders?: Headers
}

/**
 * Shared handler for `POST /api/chat` and `POST /v1/sessions/{sessionId}/messages`.
 */
export async function postSessionMessage(
  input: PostSessionMessageInput,
): Promise<NextResponse> {
  const { message, sessionId, personaId, applicantIdentity } = input
  if (!message?.trim() || !sessionId?.trim()) {
    return traceJson(
      input,
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  const projectIdOverride = input.projectId?.trim() || null
  let projectResolved: Awaited<ReturnType<typeof resolveProjectContext>>

  if (projectIdOverride) {
    if (!input.playgroundActor) {
      return traceJson(
        input,
        { error: "Project selection requires a signed-in playground session" },
        { status: 401 },
      )
    }
    const playground = await resolvePlaygroundProjectContext(
      input.playgroundActor,
      projectIdOverride,
    )
    if (!playground.ok) {
      return traceJson(input, playground.body, { status: playground.status })
    }
    projectResolved = playground
  } else {
    projectResolved = await resolveProjectContext(input.authorization)
    if (!projectResolved.ok) {
      return traceJson(input, projectResolved.body, {
        status: projectResolved.status,
      })
    }
  }
  const { organisationId, projectId, apiKeyId, settings } =
    projectResolved.context

  const botSignal = input.incomingHeaders
    ? botSignalFromHeaders(input.incomingHeaders)
    : { likelyBot: false as const }

  if (botSignal.likelyBot && process.env.GROUPCHO_REJECT_AUTOMATED_UA === "1") {
    log.warn("request_blocked_likely_bot", {
      requestId: input.requestId,
      projectId,
      sessionId,
      reason: botSignal.reason,
    })
    return traceJson(input, { error: "Forbidden" }, { status: 403 })
  }

  if (
    botSignal.likelyBot &&
    process.env.GROUPCHO_LOG_LIKELY_BOT_UA === "1"
  ) {
    log.info("likely_bot_client", {
      requestId: input.requestId,
      projectId,
      sessionId,
      reason: botSignal.reason,
    })
  }

  const rl = readRateLimitConfig()
  const apiKeyBucket = checkRateLimit({
    namespace: "apiKey",
    key: apiKeyId ?? "anon",
    limit: rl.apiKeyPerMinute,
    windowMs: 60_000,
  })
  if (!apiKeyBucket.ok) {
    return traceJson(
      input,
      { error: "Rate limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(apiKeyBucket.retryAfterMs / 1000)),
        },
      },
    )
  }

  const sessionBucket = checkRateLimit({
    namespace: "session",
    key: `${projectId}:${sessionId}`,
    limit: rl.sessionPerMinute,
    windowMs: 60_000,
  })
  if (!sessionBucket.ok) {
    return traceJson(
      input,
      { error: "Rate limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(sessionBucket.retryAfterMs / 1000)),
        },
      },
    )
  }

  if (settings.projectType === "onboarding") {
    return postOnboardingMessage({
      ...input,
      context: projectResolved.context,
      projectSettings: settings,
    })
  }

  if (apiKeyId) {
    touchApiKeyLastUsed(apiKeyId)
  }

  const openingMessage = applicationOpeningMessageForSignals(
    settings.applicationExperience.opening_message,
    applicationSignalDefinitions(
      settings.applicationExperience.required_signals,
    ),
  )

  const { data: existing } = await supabase
    .from("sessions")
    .select("id, status, persona_id, applicant_email, applicant_name")
    .eq("session_id", sessionId)
    .eq("project_id", projectId)
    .maybeSingle()

  if (existing) {
    if (isConcludedSessionStatus(existing.status)) {
      return traceJson(
        input,
        { error: "Session concluded" },
        { status: 409 },
      )
    }
    if (
      applicantIdentity?.email &&
      existing.applicant_email &&
      existing.applicant_email !== applicantIdentity.email
    ) {
      return traceJson(
        input,
        { error: "Applicant identity does not match this session" },
        { status: 409 },
      )
    }
  }

  type PersonaRow = {
    id: string
    prompt: string
    pass_threshold: number
    reject_threshold: number
    profile_schema?: unknown
    profile_extractor_hint?: string | null
  }

  let resolvedPersona: PersonaRow | null = null
  const personaCols =
    "id, prompt, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint"
  const projectPersonaId =
    typeof settings.raw.persona_id === "string"
      ? settings.raw.persona_id.trim()
      : ""
  const personaCandidates = [
    personaId?.trim(),
    typeof existing?.persona_id === "string" ? existing.persona_id.trim() : "",
    projectPersonaId,
  ].filter((id, index, ids): id is string => Boolean(id) && ids.indexOf(id) === index)

  for (const candidateId of personaCandidates) {
    const { data } = await supabase
      .from("personas")
      .select(personaCols)
      .eq("id", candidateId)
      .eq("is_active", true)
      .maybeSingle()
    if (data) {
      resolvedPersona = data as PersonaRow
      break
    }
  }

  if (!resolvedPersona) {
    const { data } = await supabase
      .from("personas")
      .select(personaCols)
      .eq("is_active", true)
      .eq("is_default", true)
      .single()
    resolvedPersona = data as PersonaRow | null
  }

  const baseSystem = resolvedPersona
    ? withTerminalDecisionAppendix(resolvedPersona.prompt)
    : withTerminalDecisionAppendix(DOORMAN_SYSTEM_PROMPT_CORE)
  const resolvedPersonaId: string | null = resolvedPersona?.id ?? null
  const passThreshold: number = resolvedPersona?.pass_threshold ?? 0.65
  const rejectThreshold: number = resolvedPersona?.reject_threshold ?? 0.25

  let sessionRowId: string
  let sessionApplicantIdentity: ApplicantIdentity | null = applicantIdentity ?? null

  if (existing) {
    if (applicantIdentity && !existing.applicant_email) {
      await supabase
        .from("sessions")
        .update(applicantIdentityPayload(applicantIdentity))
        .eq("id", existing.id)
    }
    sessionApplicantIdentity = applicantIdentity ?? applicantIdentityFromRow(existing)
    sessionRowId = existing.id
  } else {
    if (!applicantIdentity && !projectIdOverride) {
      return traceJson(
        input,
        { error: "applicant.email is required to start a session" },
        { status: 400 },
      )
    }
    const { data: created, error: createError } = await supabase
      .from("sessions")
      .insert({
        session_id: sessionId,
        persona_id: resolvedPersonaId,
        organisation_id: organisationId,
        project_id: projectId,
        ...applicantIdentityPayload(applicantIdentity),
      })
      .select("id")
      .single()

    if (createError || !created) {
      log.error("session_create_failed", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: createError?.message,
      })
      return traceJson(input, { error: "Database error" }, { status: 500 })
    }
    sessionRowId = created.id
  }

  const { data: userMsg, error: userMsgError } = await supabase
    .from("messages")
    .insert({
      session_id: sessionRowId,
      organisation_id: organisationId,
      project_id: projectId,
      role: "user",
      content: message.trim(),
    })
    .select("id")
    .single()

  if (userMsgError || !userMsg) {
    log.error("user_message_insert_failed", {
      requestId: input.requestId,
      projectId,
      sessionId,
      detail: userMsgError?.message,
    })
    return traceJson(input, { error: "Database error" }, { status: 500 })
  }

  const { data: history } = await supabase
    .from("messages")
    .select("id, role, content, metadata")
    .eq("session_id", sessionRowId)
    .order("sent_at", { ascending: true })

  const historyRows: Array<ApplicationSignalMessage & { id: string }> = (history ?? []).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    metadata: m.metadata,
  }))
  const dbHistory: ConversationMessage[] = historyRows.map(({ role, content }) => ({
    role,
    content,
  }))

  const priorHistory = historyRows.slice(0, -1)
  const localTestMode = localGatekeeperTestModeEnabled()
  const configuredSignalDefinitions = applicationSignalDefinitions(
    settings.applicationExperience.required_signals,
  )
  const signalDefinitions = localTestMode
    ? localGatekeeperTestSignalDefinitions(configuredSignalDefinitions)
    : configuredSignalDefinitions
  const storedParticipantOrientation =
    collectApplicationParticipantOrientation(priorHistory)
  const colorsAdaptiveBranchesEnabled =
    isColorsForumSignalSet(signalDefinitions)
  const routedSignalDefinitions = applicationSignalDefinitionsForOrientation(
    signalDefinitions,
    storedParticipantOrientation,
  )
  const storedSignalAnswers = collectApplicationSignalAnswers(
    priorHistory,
    signalDefinitions,
  )
  const storedInsufficientEvidenceKeys =
    collectApplicationInsufficientEvidenceKeys(priorHistory)
  const previousAssistant = [...priorHistory]
    .reverse()
    .find((entry) => entry.role === "assistant")
  const useCompactSignalState =
    signalDefinitions.length > 0 &&
    !hasLegacyUntaggedAnswers(priorHistory, signalDefinitions)
  const expectedSignal = useCompactSignalState
    ? expectedApplicationSignal(
        priorHistory,
        routedSignalDefinitions,
        storedSignalAnswers,
      )
    : null
  // The assistant message metadata owns the evidence intent. Its visible
  // wording is deliberately free to follow the conversation and should not be
  // rejected by a question-template regex.
  const currentSignal = expectedSignal
  const compactSignalAnswers = withCurrentSignalAnswer(
    storedSignalAnswers,
    currentSignal,
    message.trim(),
    false,
  )
  const conversationDepth = collectApplicationConversationDepth(priorHistory)
  const answeredQuestionCount = dbHistory.filter(
    (entry) => entry.role === "user",
  ).length
  const questionBudget = applicationQuestionBudget({
    answeredQuestions: answeredQuestionCount,
    maxQuestions: settings.applicationExperience.max_turns,
    adaptiveTurnsUsed: conversationDepth.adaptiveTurnsUsed,
  })
  const conversationThread = collectApplicationConversationThread(priorHistory)
  const responseModeHistory = collectApplicationResponseModeHistory(priorHistory)
  const bridgeHistory = collectApplicationBridgeHistory(priorHistory)

  const hasPersistedOpener =
    dbHistory.length > 0 && dbHistory[0].role === "assistant"
  const effectiveOpeningMessage = hasPersistedOpener
    ? dbHistory[0].content
    : openingMessage
  const applicationAppendix = buildApplicationExperiencePromptAppendix(
    settings.applicationExperience,
  )
  const systemPrompt = `${withConfiguredOpeningContext(
    baseSystem,
    effectiveOpeningMessage,
  )}${applicationAppendix}\n\n${GATEKEEPER_STRUCTURED_SYSTEM_SUFFIX}`

  const currentQuestion = previousAssistant?.content ?? effectiveOpeningMessage
  const claudeMessages: Anthropic.MessageParam[] = useCompactSignalState
    ? [
        {
          role: "user",
          content: buildCompactApplicationStateMessage({
            definitions: routedSignalDefinitions,
            answers: compactSignalAnswers,
            currentSignal,
            currentQuestion,
            currentAnswer: message.trim(),
            answeredQuestionCount,
            maxQuestions: settings.applicationExperience.max_turns,
            maxFollowupsPerSignal: 2,
            conversationDepth,
            conversationThread,
            responseModeHistory,
            bridgeHistory,
            questionBudget,
            participantOrientation: storedParticipantOrientation,
            adaptiveOrientationEnabled: colorsAdaptiveBranchesEnabled,
            insufficientEvidenceKeys: storedInsufficientEvidenceKeys,
          }),
        },
      ]
    : hasPersistedOpener
      ? dbHistory.map((m) => ({ role: m.role, content: m.content }))
      : [
          { role: "assistant", content: effectiveOpeningMessage },
          ...dbHistory.map((m) => ({ role: m.role, content: m.content })),
        ]

  let assistantContent = ""
  let structuredToolSeen = false
  let structuredTerminal: GatekeeperTerminalField | null = null
  let parsedNextSignalKey: string | null = null
  let answerAssessment: ApplicationAnswerAssessment | null = null
  let proposedConversationMove: ApplicationConversationMove | null = null
  let proposedResponseMode: ApplicationResponseMode | null = null
  let participantOrientation: ApplicationParticipantOrientationState =
    storedParticipantOrientation
  let culturalSignals: CulturalSignal[] = []
  let coveredSignalKeys: string[] = []
  let proposedBridgePlan: ApplicationBridgePlan = {
    candidates: [],
    selectedIndex: -1,
    selected: null,
  }
  let updatedConversationThread: ApplicationConversationThread =
    conversationThread
  let reviewerReport: ReviewerReport | null = null
  let interactionSpec = DEFAULT_INTERACTION_SPEC
  let scores: Score = {
    specificity: 0.5,
    authenticity: 0.5,
    cultural_depth: 0.5,
    overall: 0.5,
  }
  if (localTestMode) {
    const localState = useCompactSignalState
      ? { answers: compactSignalAnswers, currentSignal }
      : inferLocalGatekeeperAnswers({
          definitions: signalDefinitions,
          messages: historyRows,
        })
    const localTurn = createLocalGatekeeperTestTurn({
      definitions: signalDefinitions,
      answers: localState.answers,
      currentSignal: localState.currentSignal,
      userAnswerCount: dbHistory.filter((entry) => entry.role === "user").length,
      maxTurns: settings.applicationExperience.max_turns,
    })
    assistantContent = localTurn.assistantContent
    structuredToolSeen = true
    structuredTerminal = localTurn.structuredTerminal
    parsedNextSignalKey = localTurn.parsedNextSignalKey
    reviewerReport = localTurn.reviewerReport
    interactionSpec = localTurn.interactionSpec
    scores = localTurn.scores
    answerAssessment = localTurn.answerAssessment
    proposedConversationMove = localTurn.conversationMove
    proposedResponseMode = localTurn.responseMode
    participantOrientation = inferApplicationParticipantOrientation({
      previous: storedParticipantOrientation,
      currentAnswer: message.trim(),
    })
    coveredSignalKeys =
      currentSignal && ["usable", "rich"].includes(answerAssessment.quality)
        ? [currentSignal.key]
        : []
    updatedConversationThread = fallbackApplicationConversationThread({
      previous: conversationThread,
      currentAnswer: message.trim(),
      assessment: answerAssessment,
    })
    log.info("local_gatekeeper_test_turn", {
      requestId: input.requestId,
      projectId,
      sessionId,
      terminal: structuredTerminal,
    })
  } else {
    try {
      const model = gatekeeperConversationModel()
      const response = await client.messages.create({
        model,
        max_tokens: 1100,
        system: systemPrompt,
        messages: claudeMessages,
        tools: [gatekeeperResponseTool],
        tool_choice: { type: "tool", name: gatekeeperResponseTool.name },
      })
      logLlmUsage({
        operation: "gatekeeper_turn",
        provider: "anthropic",
        model,
        usage: response.usage,
        requestId: input.requestId,
        organisationId,
        projectId,
        sessionId,
      })

      const parsed = parseGatekeeperStructuredResponse(response.content)
      assistantContent = parsed.reply
      structuredToolSeen = parsed.toolSeen
      structuredTerminal = parsed.terminal
      parsedNextSignalKey = parsed.nextSignalKey
      answerAssessment = parsed.answerAssessment
      proposedConversationMove = parsed.conversationMove
      proposedResponseMode = parsed.responseMode
      participantOrientation = mergeApplicationParticipantOrientation({
        previous: storedParticipantOrientation,
        proposed: parsed.participantOrientation,
        currentAnswer: message.trim(),
      })
      culturalSignals = parsed.culturalSignals
      coveredSignalKeys = parsed.coveredSignalKeys
      proposedBridgePlan = parsed.bridgePlan
      updatedConversationThread =
        parsed.threadState.subject ||
        parsed.threadState.strongestDetail ||
        parsed.threadState.openHook ||
        parsed.threadState.momentum !== "new"
          ? parsed.threadState
          : fallbackApplicationConversationThread({
              previous: conversationThread,
              currentAnswer: message.trim(),
              assessment: parsed.answerAssessment,
            })
      reviewerReport = parsed.reviewerReport
      interactionSpec = parsed.interaction
      scores = parsed.scores

      if (!parsed.toolSeen) {
        log.warn("gatekeeper_structured_tool_missing", {
          requestId: input.requestId,
          projectId,
          sessionId,
          preview: assistantContent.slice(0, 120),
        })
      }
    } catch (err) {
      log.error("llm_unavailable", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: err instanceof Error ? err.message : String(err),
      })
      return traceJson(
        input,
        { error: "AI service unavailable" },
        { status: 503 },
      )
    }
  }

  coveredSignalKeys = coveredSignalKeys.filter((key) => {
    const signal = signalDefinitions.find((definition) => definition.key === key)
    return signal
      ? applicationAnswerSupportsSignal(signal, message.trim())
      : false
  })
  if (
    coveredSignalKeys.length === 0 &&
    currentSignal &&
    answerAssessment &&
    ["usable", "rich"].includes(answerAssessment.quality) &&
    applicationAnswerSupportsSignal(currentSignal, message.trim())
  ) {
    coveredSignalKeys = [currentSignal.key]
  }
  const currentSignalAttempts = applicationSignalAnswerAttemptCount(
    compactSignalAnswers.find((answer) => answer.key === currentSignal?.key),
  )
  const currentInsufficientEvidence =
    useCompactSignalState &&
    currentSignal &&
    answerAssessment?.quality === "thin" &&
    currentSignalAttempts >= 3 &&
    !coveredSignalKeys.includes(currentSignal.key)
      ? {
          key: currentSignal.key,
          label: currentSignal.label,
          attempts: currentSignalAttempts,
          reason: answerAssessment.reason,
        }
      : null
  const insufficientEvidenceKeys = new Set(storedInsufficientEvidenceKeys)
  if (currentInsufficientEvidence) {
    insufficientEvidenceKeys.add(currentInsufficientEvidence.key)
  }

  const { error: userMetadataError } = await supabase
    .from("messages")
    .update({
      metadata: {
        scores,
        ...(answerAssessment
          ? { answer_assessment: answerAssessment }
          : {}),
        ...(useCompactSignalState && currentSignal
          ? { application_signal: applicationSignalMetadata(currentSignal) }
          : {}),
        ...(useCompactSignalState
          ? {
              application_signals: signalDefinitions
                .filter((signal) => coveredSignalKeys.includes(signal.key))
                .map((signal) => applicationSignalMetadata(signal)),
            }
          : {}),
          ...(culturalSignals.length
            ? { cultural_signals: culturalSignals }
            : {}),
        participant_orientation: participantOrientation,
        ...(currentInsufficientEvidence
          ? {
              application_insufficient_evidence:
                currentInsufficientEvidence,
            }
          : {}),
      },
    })
    .eq("id", userMsg.id)
  if (userMetadataError) {
    log.error("user_message_metadata_update_failed", {
      requestId: input.requestId,
      projectId,
      sessionId,
      detail: userMetadataError.message,
    })
  }

  let status = computeTerminalStatusFromGatekeeperTurn({
    assistantContent,
    scores,
    passThreshold,
    rejectThreshold,
    structuredTerminal,
    structuredToolUsed: structuredToolSeen,
  })
  const coveredSignals = signalDefinitions.filter((signal) =>
    coveredSignalKeys.includes(signal.key),
  )
  const answersWithCoverage = useCompactSignalState
    ? withCoveredSignalAnswers(
        compactSignalAnswers,
        coveredSignals,
        message.trim(),
      )
    : compactSignalAnswers
  const answersForRouting = answersWithCoverage.map((answer) =>
    insufficientEvidenceKeys.has(answer.key)
      ? { ...answer, covered: true }
      : answer,
  )
  const activeSignalDefinitions = applicationSignalDefinitionsForOrientation(
    signalDefinitions,
    participantOrientation,
  )
  const activeSignalKeys = new Set(
    activeSignalDefinitions.map((signal) => signal.key),
  )
  const terminalWasDeferred =
    colorsAdaptiveBranchesEnabled &&
    shouldDeferApplicationTerminal({
      terminalRequested: status !== null,
      phase: questionBudget.phase,
      currentAnswerConcerning: answerAssessment?.quality === "concerning",
      answeredQuestions: questionBudget.answeredQuestions,
      remainingQuestions: questionBudget.remainingQuestions,
      definitions: activeSignalDefinitions,
      answers: answersWithCoverage,
    })
  if (terminalWasDeferred) {
    status = null
    structuredTerminal = "none"
    reviewerReport = null
  }
  const eligibleBridgeSignalKeys = new Set(
    activeSignalDefinitions
      .filter(
        (signal) =>
          !answersForRouting.some(
            (answer) =>
              answer.key === signal.key && answer.covered !== false,
          ),
      )
      .map((signal) => signal.key),
  )
  let budgetForcedClose = false
  const applicationClosingMessage =
    settings.applicationExperience.closing_message?.trim() ||
    DEFAULT_APPLICATION_CLOSING_MESSAGE
  if (
    status === null &&
    questionBudget.phase === "emergency_stop"
  ) {
    status = forcedCloseStatusFromScores({
      scores,
      passThreshold,
      rejectThreshold,
    })
    budgetForcedClose = true
  }
  let acceptedBridge: ApplicationBridgeCandidate | null =
    validateApplicationBridgeSelection({
      plan: proposedBridgePlan,
      history: bridgeHistory,
      eligibleSignalKeys: eligibleBridgeSignalKeys,
      allowCurrentSignalKey:
        proposedConversationMove === "rabbit_hole" ? currentSignal?.key : null,
      remainingQuestions: questionBudget.remainingQuestions,
      isTerminal: status !== null,
      signalPriorities: new Map(
        activeSignalDefinitions.map((signal) => [signal.key, signal.priority]),
      ),
    })
  const bridgeSelectionChanged =
    acceptedBridge !== null && acceptedBridge !== proposedBridgePlan.selected
  let bridgeWasAdjusted =
    status === null &&
    proposedBridgePlan.selected !== acceptedBridge
  let acceptedConversationMove: ApplicationConversationMove | null =
    status !== null ? "decide" : null
  let moveWasAdjusted = false
  let communityIntentFollowup = false
  let processLanguageRemoved = false
  let groundedReceiptPreserved = false
  let activeReplyRepair: {
    issue: ActiveApplicationReplyIssue
    action: "next_signal" | "forced_close"
    signalKey?: string
  } | null = null
  let nextSignal = null as (typeof signalDefinitions)[number] | null

  if (status === null && useCompactSignalState) {
    const currentAnswer = compactSignalAnswers.find(
      (answer) => answer.key === currentSignal?.key,
    )
    const attempts = applicationSignalAnswerAttemptCount(currentAnswer)
    const followupsRemaining = Math.max(0, 2 - Math.max(0, attempts - 1))
    const rejectedBridgeTargetSignalKey = bridgeWasAdjusted
      ? proposedBridgePlan.selected?.targetSignalKey ?? null
      : null
    const modelRequestedNextSignalKey =
      acceptedBridge?.targetSignalKey ??
      (bridgeWasAdjusted ? null : parsedNextSignalKey)
    const requestedNextSignalKey = modelRequestedNextSignalKey
    const advanceRepeatsCurrentSignal =
      proposedConversationMove === "advance" &&
      requestedNextSignalKey === currentSignal?.key &&
      answerAssessment?.quality === "thin"
    const inferredMove: ApplicationConversationMove =
      advanceRepeatsCurrentSignal
        ? "clarify"
        : proposedConversationMove ??
          (requestedNextSignalKey && requestedNextSignalKey === currentSignal?.key
            ? "clarify"
            : "advance")
    const hasRecoveryPotential = answerAssessment
      ? Object.values(answerAssessment.evidence).some(Boolean)
      : false
    const allowAdaptiveTurns = questionBudget.phase !== "emergency_stop"
    const allowSecondClarification =
      currentSignal?.priority === "core" && hasRecoveryPotential
    const moveValidation = validateApplicationConversationMove({
      proposedMove: inferredMove,
      assessment: answerAssessment,
      depth: conversationDepth,
      hasCurrentSignal:
        currentSignal !== null && activeSignalKeys.has(currentSignal.key),
      followupsRemaining,
      remainingQuestions: questionBudget.remainingQuestions,
      allowAdaptiveTurns,
      allowSecondClarification,
    })
    acceptedConversationMove = moveValidation.move
    moveWasAdjusted = !moveValidation.accepted

    const staysOnCurrentSignal = [
      "clarify",
      "open_door",
      "rabbit_hole",
      "challenge",
    ].includes(moveValidation.move)
    if (staysOnCurrentSignal) {
      nextSignal = currentSignal
    } else {
      const eligibleSignals = activeSignalDefinitions.filter(
        (signal) =>
          signal.key !== currentSignal?.key &&
          signal.key !== rejectedBridgeTargetSignalKey,
      )
      nextSignal = resolveNextApplicationSignal(
        requestedNextSignalKey === currentSignal?.key
          ? null
          : requestedNextSignalKey,
        eligibleSignals,
        answersForRouting,
        null,
      )
    }

    if (bridgeSelectionChanged && acceptedBridge && nextSignal) {
      const repaired = repairApplicationReplyWithQuestion({
        reply: assistantContent,
        currentAnswer: message.trim(),
        question: fallbackQuestionForApplicationBridge(acceptedBridge),
      })
      assistantContent = repaired.reply
      groundedReceiptPreserved ||= repaired.receiptPreserved
      interactionSpec = fallbackInteractionForApplicationSignal(nextSignal)
    } else if (moveValidation.move === "advance" && nextSignal) {
      const signalWasAdjusted = requestedNextSignalKey !== nextSignal.key
      if (moveWasAdjusted || signalWasAdjusted) {
        const repaired = repairApplicationReplyWithQuestion({
          reply: assistantContent,
          currentAnswer: message.trim(),
          question: fallbackQuestionForApplicationSignal(nextSignal),
        })
        assistantContent = repaired.reply
        groundedReceiptPreserved ||= repaired.receiptPreserved
        interactionSpec = fallbackInteractionForApplicationSignal(nextSignal)
        moveWasAdjusted = true
      }
    } else if (moveValidation.move === "advance" && !nextSignal) {
      status = forcedCloseStatusFromScores({
        scores,
        passThreshold,
        rejectThreshold,
      })
      budgetForcedClose = true
      acceptedConversationMove = "decide"
      acceptedBridge = null
    }

  }

  if (
    status === null &&
    useCompactSignalState &&
    colorsAdaptiveBranchesEnabled &&
    currentSignal?.cluster === "orientation" &&
    isExplicitCommunityIntent(message)
  ) {
    assistantContent = "What does community mean to you?"
    interactionSpec = fallbackInteractionForApplicationSignal(currentSignal)
    nextSignal = currentSignal
    acceptedConversationMove = "clarify"
    acceptedBridge = null
    bridgeWasAdjusted = true
    moveWasAdjusted = true
    communityIntentFollowup = true
  }

  if (status === null && useCompactSignalState) {
    const strippedReply = stripApplicationProcessLanguage(assistantContent)
    assistantContent = strippedReply.reply
    processLanguageRemoved = strippedReply.removed
  }

  if (status === null && useCompactSignalState) {
    const replyIssue = activeApplicationReplyIssue({
      reply: assistantContent,
      interaction: interactionSpec,
      closingMessage: applicationClosingMessage,
    })
    if (replyIssue) {
      const openRepairSignals = activeSignalDefinitions.filter(
        (signal) =>
          !answersForRouting.some(
            (answer) =>
              answer.key === signal.key && answer.covered !== false,
          ),
      )
      const requestedRepairSignalKey = nextSignal?.key ?? null
      const requestedRepairSignal =
        nextSignal &&
        openRepairSignals.some(
          (signal) => signal.key === requestedRepairSignalKey,
        )
          ? nextSignal
          : null
      const repairSignal =
        requestedRepairSignal ??
        resolveNextApplicationSignal(
          null,
          openRepairSignals,
          answersForRouting,
          null,
        )

      if (repairSignal) {
        const repairQuestion =
          fallbackQuestionForApplicationSignal(repairSignal)
        const repaired = repairApplicationReplyWithQuestion({
          reply:
            replyIssue === "terminal_language" ? "" : assistantContent,
          currentAnswer: message.trim(),
          question: repairQuestion,
        })
        assistantContent = repaired.reply
        groundedReceiptPreserved ||= repaired.receiptPreserved
        interactionSpec =
          fallbackInteractionForApplicationSignal(repairSignal)
        nextSignal = repairSignal
        acceptedBridge = null
        bridgeWasAdjusted = true
        moveWasAdjusted = true
        activeReplyRepair = {
          issue: replyIssue,
          action: "next_signal",
          signalKey: repairSignal.key,
        }
      } else {
        status = forcedCloseStatusFromScores({
          scores,
          passThreshold,
          rejectThreshold,
        })
        budgetForcedClose = true
        acceptedConversationMove = "decide"
        acceptedBridge = null
        nextSignal = null
        activeReplyRepair = {
          issue: replyIssue,
          action: "forced_close",
        }
      }
    }
  }

  const explicitPrompt = ensureExplicitStructuredInputPrompt({
    reply: assistantContent,
    interaction: interactionSpec,
    nextSignal,
  })
  assistantContent = explicitPrompt.reply
  if (status !== null) {
    reviewerReport = ensureEvidenceBackedReviewerReport({
      report: reviewerReport,
      terminalStatus: status,
      scores,
      definitions: activeSignalDefinitions,
      answers: answersWithCoverage,
      insufficientEvidenceKeys,
      orientation: participantOrientation,
    })
  }
  const responseMode = resolveApplicationResponseMode({
    proposed: proposedResponseMode,
    move:
      acceptedConversationMove ??
      proposedConversationMove ??
      (status !== null ? "decide" : "advance"),
    isTerminal: status !== null,
  })
  const persistedTerminal: GatekeeperTerminalField | null = budgetForcedClose
    ? terminalFieldForSessionStatus(status ?? "redirected")
    : structuredTerminal
  const assistantMetadata =
    structuredToolSeen && persistedTerminal !== null
      ? {
          gatekeeper_structured: true,
          gatekeeper_terminal: persistedTerminal,
          ui: interactionSpec,
          ...(acceptedConversationMove
            ? { conversation_move: acceptedConversationMove }
            : {}),
          ...(moveWasAdjusted ? { conversation_move_adjusted: true } : {}),
          ...(explicitPrompt.added
            ? { application_explicit_question_added: true }
            : {}),
          ...(communityIntentFollowup
            ? { application_community_intent_followup: true }
            : {}),
          ...(processLanguageRemoved
            ? { application_process_language_removed: true }
            : {}),
          ...(groundedReceiptPreserved
            ? { application_grounded_receipt_preserved: true }
            : {}),
          ...(activeReplyRepair
            ? { application_active_reply_repair: activeReplyRepair }
            : {}),
          ...(budgetForcedClose
            ? {
                application_budget_forced_close: true,
                application_budget_forced_close_outcome: {
                  source: "score_thresholds",
                  overall: scores.overall,
                  passThreshold,
                  rejectThreshold,
                  status,
                },
              }
            : {}),
          ...(terminalWasDeferred
            ? { application_terminal_deferred_for_unasked_core: true }
            : {}),
          ...(proposedBridgePlan.candidates.length
            ? {
                conversation_bridge_candidates:
                  proposedBridgePlan.candidates,
              }
            : {}),
          ...(acceptedBridge
            ? { conversation_bridge: acceptedBridge }
            : {}),
          ...(bridgeWasAdjusted
            ? { conversation_bridge_adjusted: true }
            : {}),
          response_mode: responseMode,
          participant_orientation: participantOrientation,
          ...(reviewerReport ? { reviewer_report: reviewerReport } : {}),
          conversation_thread: updatedConversationThread,
          ...(nextSignal
            ? { application_next_signal: applicationSignalMetadata(nextSignal) }
            : {}),
        }
      : null

  const modelAssistantContent = assistantContent
  const userVisibleAssistantContent =
    status !== null
      ? applicationClosingMessage
      : modelAssistantContent

  const persistedAssistantMetadata =
    status !== null
      ? {
          ...(assistantMetadata ?? {}),
          gatekeeper_model_reply: modelAssistantContent,
          application_closing: true,
        }
      : assistantMetadata

  const { error: asstError } = await supabase.from("messages").insert({
    session_id: sessionRowId,
    organisation_id: organisationId,
    project_id: projectId,
    role: "assistant",
    content: userVisibleAssistantContent,
    ...(persistedAssistantMetadata ? { metadata: persistedAssistantMetadata } : {}),
  })

  if (asstError) {
    log.error("assistant_message_insert_failed", {
      requestId: input.requestId,
      projectId,
      sessionId,
      detail: asstError.message,
    })
  }

  if (status !== null) {
    await supabase.from("sessions").update({ status }).eq("id", sessionRowId)
  }

  let profile: Awaited<ReturnType<typeof recordVerdictAndEnqueueWebhooks>>["profile"] = null
  if (status !== null) {
    const transcriptForExtraction: ConversationMessage[] = localTestMode
      ? []
      : [
          ...dbHistory,
          { role: "assistant", content: userVisibleAssistantContent },
        ]
    try {
      const result = await recordVerdictAndEnqueueWebhooks({
        organisationId,
        projectId,
        sessionInternalId: sessionRowId,
        clientSessionKey: sessionId,
        terminalStatus: status,
        scores,
        reviewerReport,
        requestId: input.requestId,
        persona: resolvedPersona
          ? {
              profile_schema: resolvedPersona.profile_schema ?? null,
              profile_extractor_hint:
                resolvedPersona.profile_extractor_hint ?? null,
            }
          : null,
        transcript: transcriptForExtraction,
        applicant: sessionApplicantIdentity,
      })
      profile = result?.profile ?? null
    } catch (err) {
      log.error("verdict_webhook_failed", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: err instanceof Error ? err.message : String(err),
      })
    }

    if (!localTestMode) {
      const signalMessages = historyRows.map((entry) => ({
        id: entry.id,
        role: entry.role,
        metadata:
          entry.id === userMsg.id && culturalSignals.length
            ? {
                ...(entry.metadata && typeof entry.metadata === "object"
                  ? entry.metadata
                  : {}),
                cultural_signals: culturalSignals,
              }
            : entry.metadata,
      }))
      try {
        await recordCompletedSessionCulturalSignals({
          organisationId,
          projectId,
          sessionId: sessionRowId,
          settings: settings.raw,
          likelyBot: botSignal.likelyBot,
          messages: signalMessages,
        })
      } catch (err) {
        log.error("cultural_signal_record_failed", {
          requestId: input.requestId,
          projectId,
          sessionId,
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return traceJson(input, {
    message: userVisibleAssistantContent,
    status: status ?? "active",
    reviewStatus: status === null ? "not_ready" : "pending",
    scores,
    ...(structuredToolSeen ? { ui: interactionSpec } : {}),
    ...(profile ? { profile } : {}),
    ...(reviewerReport ? { reviewerReport } : {}),
  })
}
