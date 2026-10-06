import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import {
  applicantIdentityPayload,
  type ApplicantIdentity,
} from "@/lib/applicant-identity"
import type { ConversationMessage, Score } from "@/lib/scoring"
import type { AdminActor } from "@/lib/admin-actor"
import {
  resolveProjectContext,
  touchApiKeyLastUsed,
  type ProjectContext,
} from "@/lib/project-resolution"
import { resolvePlaygroundProjectContext } from "@/lib/playground-projects"
import { checkRateLimit, readRateLimitConfig } from "@/lib/rate-limit"
import { log } from "@/lib/logger"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import { isConcludedSessionStatus } from "@/lib/session-status"
import { botSignalFromHeaders } from "@/lib/bot-signals"
import {
  completeSessionImmediately,
  enqueueSessionCompletionJob,
  scheduleSessionCompletionDrain,
} from "@/lib/session-completion-jobs"
import {
  gatekeeperResponseTool,
  GATEKEEPER_STRUCTURED_SYSTEM_SUFFIX,
  parseGatekeeperStructuredResponse,
  type GatekeeperTerminalField,
} from "@/lib/gatekeeper-structured-tool"
import {
  DEFAULT_INTERACTION_SPEC,
  interactionSpecForApplicationMove,
  normaliseMediaChoiceInteraction,
  validateMediaChoiceAnswer,
  type MediaChoiceAnswer,
} from "@/lib/gatekeeper-interaction-spec"
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
import { applyNaturalLanguageStyle } from "@/lib/natural-language-style"
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
  applicationSignalDefinitionsForEvidence,
  applicationSignalDefinitionsForOrientation,
  applicationOpeningMessageForSignals,
  applicationSignalAnswerAttemptCount,
  applicationSignalMetadata,
  buildCompactApplicationStateMessage,
  collectApplicationRelevantSignalKeys,
  collectApplicationSignalAnswers,
  collectApplicationInsufficientEvidenceKeys,
  newlyCoveredApplicationSignalKeys,
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
  type ApplicationParticipantOrientationState,
} from "@/lib/application-participant-orientation"
import {
  collectApplicationConversationDepth,
  validateApplicationConversationMove,
  type ApplicationAnswerAssessment,
  type ApplicationConversationMove,
} from "@/lib/application-conversation-depth"
import {
  applicationAnswerNeedsRepair,
  type ApplicationAnswerRelation,
} from "@/lib/application-answer-relation"
import {
  collectApplicationFacts,
  isApplicationProcessFeedback,
  normaliseMediaClaim,
  type ApplicationMediaClaimKind,
  type ApplicationProcessFeedbackKind,
} from "@/lib/application-facts"
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
  ensureExplicitStructuredInputPrompt,
  keepFirstApplicationQuestion,
  repairApplicationReplyWithQuestion,
  type ActiveApplicationReplyIssue,
} from "@/lib/application-turn-integrity"
import {
  applicationIntegrityChallengeQuestion,
  assessmentWithIntegrityConcerns,
  calibratedStatusForIntegrityHistory,
  collectApplicationIntegrityConcerns,
  detectApplicationIntegrityConcerns,
} from "@/lib/application-integrity-concerns"
import {
  RequestTimings,
  shouldExposeServerTimings,
} from "@/lib/request-timings"
import { resolveActiveGatekeeperPersona } from "@/lib/persona-resolution"
import {
  recordAutomaticApplicationDecision,
  type AutomaticDecisionResult,
} from "@/lib/automatic-application-decision"
import {
  buildColorsMediaQuestion,
  fetchLatestColorsShows,
} from "@/lib/colors-youtube-feed"

function traceJson(
  input: PostSessionMessageInput,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers)
  if (input.requestId) headers.set(REQUEST_ID_HEADER, input.requestId)
  if (input.timings) {
    if (shouldExposeServerTimings()) {
      headers.set("Server-Timing", input.timings.serverTimingHeader())
    }
    input.timings.logOnce({
      requestId: input.requestId,
      projectId: input.timingProjectId,
      sessionId: input.sessionId,
    })
  }
  return NextResponse.json(body, { ...init, headers })
}

const client = new Anthropic()

async function findPriorApplicationEvidence(input: {
  kind: string
  goal: string
  messages: Array<ApplicationSignalMessage & { id: string }>
  sourceMessageIds?: string[]
  requestId?: string
  organisationId: string
  projectId: string
  sessionId: string
}): Promise<string | null> {
  const candidates = input.messages.filter((message) => {
    if (message.role !== "user" || !message.content.trim()) return false
    if (input.sourceMessageIds && !input.sourceMessageIds.includes(message.id)) return false
    return !isApplicationProcessFeedback(message.metadata)
  }).slice(-10)
  if (!candidates.length) return null
  const model = gatekeeperConversationModel()
  const response = await client.messages.create({
    model,
    max_tokens: 160,
    system: input.kind === "participation"
      ? "You are a narrow evidence auditor. Decide whether the applicant has already explicitly described how they presently participate around music. Hosting, selecting, introducing, discussing, sharing, giving feedback or returning to a listening community can count when the applicant says they actually do it; a future plan alone does not. Do not infer from labels, status or enthusiasm. Cite exactly one applicant message id that supports the conclusion. Return JSON only."
      : input.kind === "contribution"
        ? "You are a narrow evidence auditor. Decide whether the applicant has already described a concrete, realistic contribution they currently make around music or could sustainably bring to this Forum. A repeatable existing habit may count when the applicant explains how it would continue here; a vague aspiration alone does not. Do not infer from labels, status or enthusiasm. Cite exactly one applicant message id that supports the conclusion. Return JSON only."
        : input.kind === "recommendation"
          ? "You are a narrow evidence auditor. The goal is evidence of one identifiable song the applicant actually recommended or shared, and why that specific song was worth sharing. General claims about selecting, introducing, or discussing music do not satisfy this goal. A song merely supplied by the exercise does not establish an actual recommendation. Return supported true only when one applicant message contains both a specific song title and a reason for sharing it. Copy the title and a short reason quote exactly from that same message; otherwise return supported false and empty strings. Cite that message id. Return JSON only."
        : "You are a narrow evidence auditor. The applicant already answered a question associated with this evidence goal, but the live coverage marker remained false. Decide whether that earlier answer directly provides usable evidence for the goal. A clear relevant perception, reason, preference, intention, or example can be usable without exhausting the topic. Do not infer facts the applicant did not say, and do not treat a request to clarify Groucho as applicant evidence. Cite exactly one supporting applicant message id, or return supported false. Return JSON only.",
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            supported: { type: "boolean" },
            sourceMessageId: { type: "string" },
            specificSongTitle: { type: "string" },
            sharingReasonQuote: { type: "string" },
          },
          required: ["supported", "sourceMessageId", "specificSongTitle", "sharingReasonQuote"],
        },
      },
    },
    messages: [{
      role: "user",
      content: JSON.stringify({
        goal: input.goal,
        applicantMessages: candidates.map((message) => ({
          id: message.id,
          content: message.content,
        })),
      }),
    }],
  })
  logLlmUsage({
    operation: "gatekeeper_prior_signal_audit",
    provider: "anthropic",
    model,
    usage: response.usage,
    requestId: input.requestId,
    organisationId: input.organisationId,
    projectId: input.projectId,
    sessionId: input.sessionId,
  })
  const textBlock = response.content.find((block) => block.type === "text")
  const result = textBlock?.type === "text"
    ? JSON.parse(textBlock.text) as {
        supported?: unknown
        sourceMessageId?: unknown
        specificSongTitle?: unknown
        sharingReasonQuote?: unknown
      }
    : null
  const source = candidates.find((message) => message.id === result?.sourceMessageId)
  if (input.kind === "recommendation") {
    const title = typeof result?.specificSongTitle === "string"
      ? result.specificSongTitle.trim()
      : ""
    const reason = typeof result?.sharingReasonQuote === "string"
      ? result.sharingReasonQuote.trim()
      : ""
    if (!source || title.length < 2 || reason.length < 8 ||
      !source.content.toLocaleLowerCase().includes(title.toLocaleLowerCase()) ||
      !source.content.toLocaleLowerCase().includes(reason.toLocaleLowerCase())) {
      return null
    }
  }
  return result?.supported === true &&
    typeof result.sourceMessageId === "string" &&
    source !== undefined
      ? result.sourceMessageId
      : null
}

async function recommendationQuestionMatchesGoal(input: {
  reply: string
  goal: string
  requestId?: string
  organisationId: string
  projectId: string
  sessionId: string
}): Promise<boolean> {
  const model = gatekeeperConversationModel()
  const response = await client.messages.create({
    model,
    max_tokens: 64,
    system: "Check whether the actual invitation in Groucho's visible reply asks for the target evidence goal. Judge meaning, not shared words or the internal signal label. A broad question about participation, curation, or feedback is not an invitation to name a specific song actually recommended and explain why it was shared. Ignore reflective statements before the invitation. Return JSON only.",
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { aligned: { type: "boolean" } },
          required: ["aligned"],
        },
      },
    },
    messages: [{
      role: "user",
      content: JSON.stringify({ reply: input.reply, goal: input.goal }),
    }],
  })
  logLlmUsage({
    operation: "gatekeeper_recommendation_question_alignment",
    provider: "anthropic",
    model,
    usage: response.usage,
    requestId: input.requestId,
    organisationId: input.organisationId,
    projectId: input.projectId,
    sessionId: input.sessionId,
  })
  const textBlock = response.content.find((block) => block.type === "text")
  const result = textBlock?.type === "text"
    ? JSON.parse(textBlock.text) as { aligned?: unknown }
    : null
  return result?.aligned === true
}

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

function isArtistReferenceSignal(signal: { kind: string }): boolean {
  return signal.kind === "artist_reference"
}

function isRecommendationSignal(signal: { kind: string }): boolean {
  return signal.kind === "recommendation"
}

function fallbackQuestionForApplicationSignal(signal: {
  kind: string
  label: string
  promptRoutes?: string[]
}, options?: { hasArtistAntecedent?: boolean }): string {
  const routes = signal.promptRoutes ?? []
  const candidate =
    (isRecommendationSignal(signal) && options?.hasArtistAntecedent === false
      ? routes.find(
          (route) =>
            !/\b(?:one|which) of their (?:songs?|tracks?|pieces?|records?)\b/i.test(
              route,
            ),
        )
      : routes[0])?.trim() || signal.label.trim()
  return candidate.endsWith("?")
    ? candidate
    : `${candidate.replace(/[.!]+$/, "")}?`
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

function historyHasMediaChoice(history: ApplicationSignalMessage[]): boolean {
  return history.some((entry) => {
    if (
      entry.role !== "assistant" ||
      !entry.metadata ||
      typeof entry.metadata !== "object" ||
      Array.isArray(entry.metadata)
    ) {
      return false
    }
    const metadata = entry.metadata as Record<string, unknown>
    if (!metadata.ui || typeof metadata.ui !== "object" || Array.isArray(metadata.ui)) {
      return false
    }
    const ui = metadata.ui as Record<string, unknown>
    return normaliseMediaChoiceInteraction(ui.mediaChoice) !== undefined
  })
}

function colorsMediaPilotEnabled(
  projectIdOverride: string | null,
  settings: Record<string, unknown>,
): boolean {
  return (
    Boolean(projectIdOverride) ||
    settings.environment === "test" ||
    settings.session_mode === "dry-run"
  )
}

export type PostSessionMessageInput = {
  authorization: string | null
  sessionId: string
  message: string
  interactionAnswer?: MediaChoiceAnswer
  personaId?: string | null
  applicantIdentity?: ApplicantIdentity | null
  /** Playground (`/doorcheck`): explicit project when caller is authenticated. */
  projectId?: string | null
  playgroundActor?: AdminActor | null
  /** Server-validated, fixed COLORS project context; never accepted from a client body. */
  demoProjectContext?: ProjectContext
  /** Authenticated COLORS demo: add the private, full-transcript reviewer preview. */
  demoReviewerPreview?: boolean
  /** From `x-request-id` middleware; echoed on responses and included in structured logs. */
  requestId?: string
  /** When set, used for optional bot UA heuristics (`GROUPCHO_*` env). */
  incomingHeaders?: Headers
  /** Internal per-request latency tracing; never supplied by public callers. */
  timings?: RequestTimings
  timingProjectId?: string
}

/**
 * Shared handler for `POST /api/chat` and `POST /v1/sessions/{sessionId}/messages`.
 */
export async function postSessionMessage(
  input: PostSessionMessageInput,
): Promise<NextResponse> {
  input.timings ??= new RequestTimings()
  const timings = input.timings
  const { sessionId, personaId, applicantIdentity } = input
  let message = input.message
  if (!message?.trim() || !sessionId?.trim()) {
    return traceJson(
      input,
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  const projectIdOverride = input.projectId?.trim() || null
  let projectResolved: Awaited<ReturnType<typeof resolveProjectContext>>

  const finishProjectResolution = timings.start("project_resolution")
  if (input.demoProjectContext) {
    projectResolved = { ok: true, context: input.demoProjectContext }
  } else if (projectIdOverride) {
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
  finishProjectResolution()
  const { organisationId, projectId, apiKeyId, settings } =
    projectResolved.context
  input.timingProjectId = projectId

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

  const { data: existing } = await timings.measure("session_lookup", () => supabase
    .from("sessions")
    .select("id, status, persona_id, applicant_email, applicant_name")
    .eq("session_id", sessionId)
    .eq("project_id", projectId)
    .maybeSingle())

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

  if (input.interactionAnswer) {
    if (!existing) {
      return traceJson(
        input,
        { error: "A media choice answer requires an active question" },
        { status: 400 },
      )
    }
    const { data: lastAssistant } = await supabase
      .from("messages")
      .select("metadata")
      .eq("session_id", existing.id)
      .eq("role", "assistant")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const metadata =
      lastAssistant?.metadata &&
      typeof lastAssistant.metadata === "object" &&
      !Array.isArray(lastAssistant.metadata)
        ? (lastAssistant.metadata as Record<string, unknown>)
        : null
    const rawUi =
      metadata?.ui &&
      typeof metadata.ui === "object" &&
      !Array.isArray(metadata.ui)
        ? (metadata.ui as Record<string, unknown>)
        : null
    const mediaChoice = normaliseMediaChoiceInteraction(rawUi?.mediaChoice)
    if (!mediaChoice) {
      return traceJson(
        input,
        { error: "The active question does not accept a media choice answer" },
        { status: 400 },
      )
    }
    const validated = validateMediaChoiceAnswer(input.interactionAnswer, mediaChoice)
    if (!validated.ok) {
      return traceJson(input, { error: validated.error }, { status: 400 })
    }
    message = validated.message
    input.interactionAnswer = validated.answer
  }

  const projectPersonaId =
    typeof settings.raw.persona_id === "string"
      ? settings.raw.persona_id.trim()
      : ""
  const personaCandidates = [
    personaId?.trim(),
    typeof existing?.persona_id === "string" ? existing.persona_id.trim() : "",
    projectPersonaId,
  ].filter((id, index, ids): id is string => Boolean(id) && ids.indexOf(id) === index)

  const resolvedPersona = await timings.measure("persona_resolution", () =>
    resolveActiveGatekeeperPersona(personaCandidates),
  )

  const baseSystem = resolvedPersona
    ? withTerminalDecisionAppendix(resolvedPersona.prompt)
    : withTerminalDecisionAppendix(DOORMAN_SYSTEM_PROMPT_CORE)
  const resolvedPersonaId: string | null = resolvedPersona?.id ?? null
  const passThreshold: number = resolvedPersona?.pass_threshold ?? 0.65
  const rejectThreshold: number = resolvedPersona?.reject_threshold ?? 0.25

  let sessionRowId: string
  if (existing) {
    if (applicantIdentity && !existing.applicant_email) {
      await supabase
        .from("sessions")
        .update(applicantIdentityPayload(applicantIdentity))
        .eq("id", existing.id)
    }
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

  const { data: userMsg, error: userMsgError } = await timings.measure("user_persistence", () => supabase
    .from("messages")
    .insert({
      session_id: sessionRowId,
      organisation_id: organisationId,
      project_id: projectId,
      role: "user",
      content: message.trim(),
      ...(input.interactionAnswer
        ? { metadata: { interaction_answer: input.interactionAnswer } }
        : {}),
    })
    .select("id")
    .single())

  if (userMsgError || !userMsg) {
    log.error("user_message_insert_failed", {
      requestId: input.requestId,
      projectId,
      sessionId,
      detail: userMsgError?.message,
    })
    return traceJson(input, { error: "Database error" }, { status: 500 })
  }

  const { data: history } = await timings.measure("history_load", () => supabase
    .from("messages")
    .select("id, role, content, metadata")
    .eq("session_id", sessionRowId)
    .order("sent_at", { ascending: true }))

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
  const priorFacts = collectApplicationFacts(priorHistory)
  const currentFacts = input.interactionAnswer
    ? collectApplicationFacts(historyRows.map((entry) => entry.id === userMsg.id
      ? { ...entry, metadata: { interaction_answer: input.interactionAnswer } }
      : entry))
    : priorFacts
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
  const currentIntegrityConcerns = colorsAdaptiveBranchesEnabled
    ? detectApplicationIntegrityConcerns(message.trim())
    : []
  const storedIntegrityConcerns = collectApplicationIntegrityConcerns(priorHistory)
  const routedSignalDefinitions = applicationSignalDefinitionsForOrientation(
    signalDefinitions,
    storedParticipantOrientation,
  )
  const storedSignalAnswers = collectApplicationSignalAnswers(
    priorHistory,
    signalDefinitions,
  )
  const storedRelevantSignalKeys = collectApplicationRelevantSignalKeys(
    priorHistory,
    signalDefinitions,
  )
  const priorRelevantSignalDefinitions =
    applicationSignalDefinitionsForEvidence(
      routedSignalDefinitions,
      storedRelevantSignalKeys,
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
        priorRelevantSignalDefinitions,
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
    userMsg.id,
  )
  const conversationDepth = collectApplicationConversationDepth(priorHistory)
  let answeredQuestionCount = historyRows.filter((entry) => {
    if (entry.role !== "user") return false
    const metadata = entry.metadata as Record<string, unknown> | null
    const relation = metadata?.application_answer_relation as Record<string, unknown> | undefined
    return relation?.kind !== "clarification_request"
  }).length
  let questionBudget = applicationQuestionBudget({
    answeredQuestions: answeredQuestionCount,
    maxQuestions: settings.applicationExperience.max_turns,
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
            recentApplicantAnswers: priorHistory
              .filter((entry) => entry.role === "user")
              .slice(-4)
              .map((entry) => entry.content),
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
            facts: currentFacts,
            insufficientEvidenceKeys: storedInsufficientEvidenceKeys,
            relevantSignalKeys: storedRelevantSignalKeys,
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
  let answerRelation: ApplicationAnswerRelation | null = null
  let processFeedback: ApplicationProcessFeedbackKind = "none"
  let mediaClaim: { kind: ApplicationMediaClaimKind; quote: string } = {
    kind: "none", quote: "",
  }
  let proposedConversationMove: ApplicationConversationMove | null = null
  let proposedResponseMode: ApplicationResponseMode | null = null
  let participantOrientation: ApplicationParticipantOrientationState =
    storedParticipantOrientation
  let coveredSignalKeys: string[] = []
  let proposedRelevantSignalKeys: string[] = []
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
      const response = await timings.measure("conversation_model", () => client.messages.create({
        model,
        max_tokens: 500,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: claudeMessages,
        tools: [gatekeeperResponseTool],
        tool_choice: { type: "tool", name: gatekeeperResponseTool.name },
      }))
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
      answerRelation = parsed.answerRelation
      processFeedback = parsed.processFeedback
      mediaClaim = normaliseMediaClaim(parsed.mediaClaim, message.trim())
      proposedConversationMove = parsed.conversationMove
      proposedResponseMode = null
      participantOrientation = inferApplicationParticipantOrientation({
        previous: storedParticipantOrientation,
        currentAnswer: message.trim(),
      })
      coveredSignalKeys = parsed.coveredSignalKeys
      proposedRelevantSignalKeys = parsed.relevantSignalKeys
      proposedBridgePlan = { candidates: [], selectedIndex: -1, selected: null }
      updatedConversationThread = fallbackApplicationConversationThread({
        previous: conversationThread,
        currentAnswer: message.trim(),
        assessment: parsed.answerAssessment,
      })
      reviewerReport = parsed.reviewerReport
      interactionSpec = useCompactSignalState
        ? interactionSpecForApplicationMove(
            parsed.conversationMove,
            parsed.terminal ?? "none",
          )
        : parsed.interaction
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

  answerAssessment = assessmentWithIntegrityConcerns(
    answerAssessment,
    currentIntegrityConcerns,
  )
  const turnIsClarificationRequest =
    useCompactSignalState &&
    answerRelation?.kind === "clarification_request" &&
    currentIntegrityConcerns.length === 0
  const turnIsProcessFeedback = useCompactSignalState &&
    currentIntegrityConcerns.length === 0 &&
    (turnIsClarificationRequest || processFeedback !== "none")
  if (turnIsProcessFeedback) {
    answeredQuestionCount = Math.max(0, answeredQuestionCount - 1)
    questionBudget = applicationQuestionBudget({
      answeredQuestions: answeredQuestionCount,
      maxQuestions: settings.applicationExperience.max_turns,
    })
    answerAssessment = null
    participantOrientation = storedParticipantOrientation
    coveredSignalKeys = []
    proposedRelevantSignalKeys = []
    parsedNextSignalKey = null
    proposedBridgePlan = { candidates: [], selectedIndex: -1, selected: null }
    proposedConversationMove = turnIsClarificationRequest ? "clarify" : "advance"
    proposedResponseMode = "probe"
    updatedConversationThread = conversationThread
    interactionSpec = interactionSpecForApplicationMove(proposedConversationMove, "none")
  }
  if (
    proposedConversationMove === "challenge" &&
    answerAssessment &&
    answerAssessment.quality !== "concerning"
  ) {
    // Keep Claude's structured intent internally consistent. A challenge is
    // the semantic signal that this answer needs boundary clarification.
    answerAssessment = { ...answerAssessment, quality: "concerning" }
  }
  const semanticChallengeTurn =
    answerAssessment?.quality === "concerning" ||
    proposedConversationMove === "challenge"
  const turnNeedsConversationalRepair =
    useCompactSignalState &&
    currentIntegrityConcerns.length === 0 &&
    !turnIsProcessFeedback && applicationAnswerNeedsRepair(answerRelation)
  if (answerAssessment?.quality === "concerning") {
    proposedConversationMove = "challenge"
    proposedResponseMode = "challenge"
  }

  const configuredSignalKeys = new Set(signalDefinitions.map((signal) => signal.key))
  coveredSignalKeys = newlyCoveredApplicationSignalKeys(
    coveredSignalKeys,
    signalDefinitions,
    storedSignalAnswers,
  )
  const priorAssistantMetadata = previousAssistant?.metadata &&
    typeof previousAssistant.metadata === "object" &&
    !Array.isArray(previousAssistant.metadata)
    ? previousAssistant.metadata as Record<string, unknown>
    : null
  if (input.interactionAnswer || priorAssistantMetadata?.application_media_depth_followup === true) {
    // The supplied exercise is hypothetical curation, not evidence that the
    // applicant has recommended or shared any of its songs with someone.
    const recommendationKeys = new Set(signalDefinitions
      .filter((signal) => signal.kind === "recommendation")
      .map((signal) => signal.key))
    coveredSignalKeys = coveredSignalKeys.filter((key) => !recommendationKeys.has(key))
  }
  const evaluatedSignalAnswers = turnIsProcessFeedback
    ? storedSignalAnswers
    : compactSignalAnswers
  const currentSignalAttempts = applicationSignalAnswerAttemptCount(
    evaluatedSignalAnswers.find((answer) => answer.key === currentSignal?.key),
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
  const relevantSignalKeys = new Set(storedRelevantSignalKeys)
  for (const key of [
    ...proposedRelevantSignalKeys,
    ...coveredSignalKeys,
    ...(parsedNextSignalKey ? [parsedNextSignalKey] : []),
  ]) {
    if (configuredSignalKeys.has(key)) relevantSignalKeys.add(key)
  }

  const { error: userMetadataError } = await supabase
    .from("messages")
    .update({
      metadata: {
        ...(input.interactionAnswer
          ? { interaction_answer: input.interactionAnswer }
          : {}),
        ...(turnIsProcessFeedback ? {} : { scores }),
        ...(answerAssessment
          ? { answer_assessment: answerAssessment }
          : {}),
        ...(answerRelation
          ? { application_answer_relation: answerRelation }
          : {}),
        ...(processFeedback !== "none"
          ? { application_process_feedback: { kind: processFeedback, sourceMessageId: userMsg.id } }
          : {}),
        ...(mediaClaim.kind !== "none"
          ? { application_media_claim: { ...mediaClaim, sourceMessageId: userMsg.id } }
          : {}),
        ...(useCompactSignalState && currentSignal
          ? { application_signal: applicationSignalMetadata(currentSignal) }
          : {}),
        ...(useCompactSignalState
          ? {
              application_signals: signalDefinitions
                .filter((signal) => coveredSignalKeys.includes(signal.key))
                .map((signal) => applicationSignalMetadata(signal)),
              application_relevant_signals: signalDefinitions
                .filter((signal) => relevantSignalKeys.has(signal.key))
                .map((signal) => applicationSignalMetadata(signal)),
            }
          : {}),
        participant_orientation: participantOrientation,
        ...(currentInsufficientEvidence
          ? {
              application_insufficient_evidence:
                currentInsufficientEvidence,
            }
          : {}),
        ...(currentIntegrityConcerns.length
          ? { application_integrity_concerns: currentIntegrityConcerns }
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

  let semanticConcernTerminalDeferred = false
  let status = computeTerminalStatusFromGatekeeperTurn({
    assistantContent,
    scores,
    passThreshold,
    rejectThreshold,
    structuredTerminal,
    structuredToolUsed: structuredToolSeen,
  })
  if (
    (turnNeedsConversationalRepair || turnIsProcessFeedback) &&
    questionBudget.phase !== "emergency_stop"
  ) {
    status = null
    structuredTerminal = "none"
    reviewerReport = null
  }
  const calibratedIntegrityStatus =
    calibratedStatusForIntegrityHistory({
      stored: storedIntegrityConcerns,
      current: currentIntegrityConcerns,
      terminalProposed: status !== null,
    })
  if (currentIntegrityConcerns.length > 0) {
    if (calibratedIntegrityStatus) {
      status = calibratedIntegrityStatus
      structuredTerminal = terminalFieldForSessionStatus(
        calibratedIntegrityStatus,
      )
    } else {
      // A first explicit concern gets one calm challenge even if the model
      // attempts to decide immediately.
      status = null
      structuredTerminal = "none"
      reviewerReport = null
    }
  } else if (semanticChallengeTurn) {
    // A semantic challenge and a terminal decision are mutually exclusive.
    // Claude may recognise contextual concern that the deliberately narrow
    // deterministic detector cannot classify, but that must remain a question
    // rather than becoming a trusted reviewer allegation on the same turn.
    semanticConcernTerminalDeferred = status !== null
    status = null
    structuredTerminal = "none"
    reviewerReport = null
    interactionSpec = interactionSpecForApplicationMove("challenge", "none")
  } else if (calibratedIntegrityStatus) {
    status = calibratedIntegrityStatus
    structuredTerminal = terminalFieldForSessionStatus(
      calibratedIntegrityStatus,
    )
  }
  const coveredSignals = signalDefinitions.filter((signal) =>
    coveredSignalKeys.includes(signal.key),
  )
  let answersWithCoverage = useCompactSignalState
    ? withCoveredSignalAnswers(
      evaluatedSignalAnswers,
      coveredSignals,
      message.trim(),
      userMsg.id,
    )
    : compactSignalAnswers
  let answersForRouting = answersWithCoverage.map((answer) =>
    insufficientEvidenceKeys.has(answer.key)
      ? { ...answer, covered: true }
      : answer,
  )
  const mediaExerciseAnswerIds = new Set<string>()
  if (currentFacts.mediaChoice) {
    for (let index = 1; index < historyRows.length; index += 1) {
      const entry = historyRows[index]
      const previous = historyRows[index - 1]
      if (entry.role !== "user" || previous.role !== "assistant") continue
      const metadata = previous.metadata && typeof previous.metadata === "object" &&
        !Array.isArray(previous.metadata)
        ? previous.metadata as Record<string, unknown>
        : null
      const ui = metadata?.ui && typeof metadata.ui === "object" &&
        !Array.isArray(metadata.ui)
        ? metadata.ui as Record<string, unknown>
        : null
      if (normaliseMediaChoiceInteraction(ui?.mediaChoice) ||
        metadata?.application_media_depth_followup === true) {
        mediaExerciseAnswerIds.add(entry.id)
      }
    }
  }
  const hasArtistAntecedent = answersForRouting.some(
    (answer) =>
      answer.covered !== false &&
      answer.answer.trim().length > 0 &&
      answer.kind === "artist_reference" &&
      (!currentFacts.mediaChoice || answer.sources?.some((source) =>
        !mediaExerciseAnswerIds.has(source.messageId))),
  )
  const activeSignalDefinitions = applicationSignalDefinitionsForEvidence(
    applicationSignalDefinitionsForOrientation(
      signalDefinitions,
      participantOrientation,
    ),
    relevantSignalKeys,
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
  if (status === null && semanticChallengeTurn) {
    const concernReplyIssue = activeApplicationReplyIssue({
      reply: assistantContent,
      interaction: interactionSpec,
      closingMessage: applicationClosingMessage,
      hasArtistAntecedent,
    })
    if (concernReplyIssue === "missing_invitation" || concernReplyIssue === "terminal_language") {
      assistantContent = repairApplicationReplyWithQuestion({
        reply: concernReplyIssue === "terminal_language" ? "" : assistantContent,
        currentAnswer: message.trim(),
        question: "Can you say more about how you understand the trust boundary in what you just described?",
      }).reply
    }
  }
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
    })
  if (turnNeedsConversationalRepair) {
    acceptedBridge = null
  }
  const bridgeSelectionChanged =
    acceptedBridge !== null && acceptedBridge !== proposedBridgePlan.selected
  let bridgeWasAdjusted =
    status === null &&
    proposedBridgePlan.selected !== acceptedBridge
  let acceptedConversationMove: ApplicationConversationMove | null =
    status !== null ? "decide" : null
  let moveWasAdjusted = false
  let openingClarification = false
  let conversationalThreadTurn = false
  let groundedReceiptPreserved = false
  let colorsMediaQuestionInserted = false
  let colorsMediaDepthFollowup = false
  const recoveredSignalEvidence: Array<{
    signalKey: string
    sourceMessageId: string
  }> = []
  let activeReplyRepair: {
    issue: ActiveApplicationReplyIssue | "signal_question_mismatch"
    action: "next_signal" | "same_thread" | "forced_close"
    signalKey?: string
  } | null = null
  let nextSignal = null as (typeof signalDefinitions)[number] | null

  if (
    status === null &&
    useCompactSignalState &&
    turnNeedsConversationalRepair
  ) {
    acceptedConversationMove = "clarify"
    moveWasAdjusted = proposedConversationMove !== "clarify"
    bridgeWasAdjusted ||= proposedBridgePlan.selected !== null
    conversationalThreadTurn = true
  }

  if (status === null && turnIsClarificationRequest) {
    acceptedConversationMove = "clarify"
    moveWasAdjusted = proposedConversationMove !== "clarify"
    nextSignal = currentSignal
    conversationalThreadTurn = false
  }

  if (
    status === null &&
    useCompactSignalState &&
    !turnNeedsConversationalRepair &&
    !turnIsClarificationRequest
  ) {
    const currentAnswer = evaluatedSignalAnswers.find(
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
      currentIntegrityConcerns.length > 0
        ? "challenge"
        : advanceRepeatsCurrentSignal
        ? "clarify"
        : proposedConversationMove ??
          (requestedNextSignalKey && requestedNextSignalKey === currentSignal?.key
            ? "clarify"
            : "advance")
    const hasRecoveryPotential = answerAssessment
      ? Object.values(answerAssessment.evidence).some(Boolean)
      : false
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

    if (
      nextSignal &&
      isRecommendationSignal(nextSignal) &&
      !hasArtistAntecedent
    ) {
      const openArtistReferenceSignal = activeSignalDefinitions.find(
        (signal) =>
          isArtistReferenceSignal(signal) &&
          !answersForRouting.some(
            (answer) =>
              answer.key === signal.key && answer.covered !== false,
          ),
      )
      if (openArtistReferenceSignal) {
        nextSignal = openArtistReferenceSignal
        acceptedBridge = null
        bridgeWasAdjusted = true
        moveWasAdjusted = true
      }
    }

    if (
      moveValidation.move === "challenge" &&
      currentIntegrityConcerns.length > 0 &&
      nextSignal
    ) {
      assistantContent = applicationIntegrityChallengeQuestion(
        currentIntegrityConcerns,
      )
      interactionSpec = fallbackInteractionForApplicationSignal(nextSignal)
      acceptedBridge = null
      bridgeWasAdjusted ||= proposedBridgePlan.selected !== null
      moveWasAdjusted = true
    } else if (bridgeSelectionChanged && acceptedBridge && nextSignal) {
      interactionSpec = fallbackInteractionForApplicationSignal(nextSignal)
    } else if (moveValidation.move === "advance" && nextSignal) {
      const signalWasAdjusted = requestedNextSignalKey !== nextSignal.key
      if (moveWasAdjusted || signalWasAdjusted) {
        interactionSpec = fallbackInteractionForApplicationSignal(nextSignal)
        moveWasAdjusted = true
      }
    } else if (moveValidation.move === "advance" && !nextSignal) {
      conversationalThreadTurn = true
    }

  }

  if (status === null && nextSignal && !turnIsClarificationRequest) {
    const signalInteraction = fallbackInteractionForApplicationSignal(nextSignal)
    if (signalInteraction.inputType !== "text") {
      interactionSpec = signalInteraction
    }
  }

  if (
    status === null &&
    colorsAdaptiveBranchesEnabled &&
    input.interactionAnswer &&
    currentSignal?.cluster === "cultural_point_of_view" &&
    questionBudget.phase !== "emergency_stop"
  ) {
    // A remove choice has no order. Use the exercise's one bounded depth
    // question rather than letting a fluent model reply imply a sequence.
    assistantContent =
      "What relationship among the performances you kept would you test before settling the programme?"
    interactionSpec = interactionSpecForApplicationMove("clarify", "none")
    nextSignal = currentSignal
    acceptedConversationMove = "clarify"
    acceptedBridge = null
    colorsMediaDepthFollowup = true
    moveWasAdjusted = true
  }

  if (
    status === null &&
    useCompactSignalState &&
    colorsAdaptiveBranchesEnabled &&
    currentSignal?.cluster === "orientation" &&
    answerAssessment?.quality === "thin" &&
    !turnIsClarificationRequest &&
    nextSignal?.key !== currentSignal.key
  ) {
    assistantContent = fallbackQuestionForApplicationSignal(currentSignal)
    interactionSpec = fallbackInteractionForApplicationSignal(currentSignal)
    nextSignal = currentSignal
    acceptedConversationMove = "clarify"
    acceptedBridge = null
    bridgeWasAdjusted = true
    moveWasAdjusted = true
    openingClarification = true
  }

  if (status === null && useCompactSignalState) {
    const recentApplicationQuestions = priorHistory
      .filter((entry) => entry.role === "assistant")
      .slice(-5)
      .map((entry) => entry.content)
      .join("\n")
    const replyIssue = activeApplicationReplyIssue({
      reply: assistantContent,
      interaction: interactionSpec,
      closingMessage: applicationClosingMessage,
      previousQuestion: recentApplicationQuestions || currentQuestion,
      hasArtistAntecedent,
    })
    const repeatedClarification = turnIsClarificationRequest && priorHistory.some((entry) => {
      const metadata = entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
        ? entry.metadata as Record<string, unknown>
        : null
      const relation = metadata?.application_answer_relation
      return entry.role === "user" && relation && typeof relation === "object" &&
        (relation as Record<string, unknown>).kind === "clarification_request"
    })
    if (turnIsClarificationRequest && (replyIssue || repeatedClarification)) {
      let repairedReply = ""
      try {
        const model = gatekeeperConversationModel()
        const repairResponse = await timings.measure("clarification_repair_model", () =>
          client.messages.create({
            model,
            max_tokens: 180,
            system: "Repair Groucho's unclear preceding turn. The applicant has asked Groucho to clarify, not supplied application evidence. Own the ambiguity in a brief sentence, then ask one explicit question grounded in the preceding substantive applicant answer. If Groucho's preceding line was only an observation, say so. Do not ask the applicant to explain what they meant, repeat an answered selector, diagnose their mood, or change topic. Return JSON with reply only.",
            output_config: {
              format: {
                type: "json_schema",
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: { reply: { type: "string" } },
                  required: ["reply"],
                },
              },
            },
            messages: [{
              role: "user",
              content: JSON.stringify({
                precedingTurns: priorHistory.slice(-6).map((entry) => ({
                  role: entry.role,
                  content: entry.content,
                })),
                applicantClarificationRequest: message.trim(),
              }),
            }],
          }),
        )
        logLlmUsage({
          operation: "gatekeeper_clarification_repair",
          provider: "anthropic",
          model,
          usage: repairResponse.usage,
          requestId: input.requestId,
          organisationId,
          projectId,
          sessionId,
        })
        const textBlock = repairResponse.content.find((block) => block.type === "text")
        const candidate = textBlock?.type === "text"
          ? (JSON.parse(textBlock.text) as { reply?: unknown }).reply
          : null
        if (typeof candidate === "string" && !activeApplicationReplyIssue({
          reply: candidate,
          interaction: interactionSpec,
          closingMessage: applicationClosingMessage,
        })) {
          repairedReply = candidate.trim()
        }
      } catch (error) {
        log.warn("application_clarification_repair_failed", {
          requestId: input.requestId,
          projectId,
          sessionId,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
      assistantContent = repairedReply ||
        `You're right—that was an observation, not a clear question. ${
          currentSignal
            ? fallbackQuestionForApplicationSignal(currentSignal, { hasArtistAntecedent })
            : "What would you want the Forum to understand about your approach?"
        }`
      moveWasAdjusted = true
    } else if (replyIssue === "unclear_invitation") {
      const sameThreadQuestion =
        currentSignal && (isArtistReferenceSignal(currentSignal) || isRecommendationSignal(currentSignal))
          ? "What would you want a listener to notice about that choice?"
          : "What would you want me to understand about that?"
      const repaired = repairApplicationReplyWithQuestion({
        reply: assistantContent,
        currentAnswer: message.trim(),
        question: sameThreadQuestion,
      })
      assistantContent = repaired.reply
      groundedReceiptPreserved ||= repaired.receiptPreserved
      interactionSpec = interactionSpecForApplicationMove("clarify", "none")
      nextSignal = currentSignal
      acceptedBridge = null
      acceptedConversationMove =
        answerAssessment?.quality === "rich" ? "rabbit_hole" : "clarify"
      conversationalThreadTurn = currentSignal === null
      moveWasAdjusted = true
      activeReplyRepair = {
        issue: replyIssue,
        action: "same_thread",
        ...(currentSignal ? { signalKey: currentSignal.key } : {}),
      }
    } else if (replyIssue === "multiple_questions") {
      assistantContent = keepFirstApplicationQuestion(assistantContent)
      acceptedConversationMove =
        acceptedConversationMove ?? proposedConversationMove ?? "advance"
      moveWasAdjusted = true
    } else if (replyIssue) {
      const openRepairSignals = activeSignalDefinitions.filter(
        (signal) =>
          !answersForRouting.some(
            (answer) =>
              answer.key === signal.key && answer.covered !== false,
          ),
      )
      const repairSignals = openRepairSignals.filter((signal) =>
        activeApplicationReplyIssue({
          reply: fallbackQuestionForApplicationSignal(signal, {
            hasArtistAntecedent,
          }),
          interaction: fallbackInteractionForApplicationSignal(signal),
          closingMessage: applicationClosingMessage,
          previousQuestion: recentApplicationQuestions || currentQuestion,
          hasArtistAntecedent,
        }) === null,
      )
      const requestedRepairSignalKey = nextSignal?.key ?? null
      const requestedRepairSignal =
        nextSignal &&
        repairSignals.some(
          (signal) => signal.key === requestedRepairSignalKey,
        )
          ? nextSignal
          : null
      const repairSignal =
        requestedRepairSignal ??
        resolveNextApplicationSignal(
          null,
          repairSignals,
          answersForRouting,
          null,
        )

      if (repairSignal) {
        const repairQuestion =
          fallbackQuestionForApplicationSignal(repairSignal, {
            hasArtistAntecedent,
          })
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

  if (status === null && !nextSignal) {
    conversationalThreadTurn = true
  }

  // A completed media exercise gets one depth question, not an indefinite
  // rabbit hole. Applicant corrections and requests to move on are not fit
  // evidence and should not be routed back to the same exercise.
  if (
    status === null &&
    priorFacts.mediaChoice?.depthFollowupUsed &&
    currentSignal?.cluster === "cultural_point_of_view" &&
    !turnIsClarificationRequest
  ) {
    const onward = resolveNextApplicationSignal(
      null,
      activeSignalDefinitions.filter((signal) => signal.key !== currentSignal.key),
      answersForRouting,
      null,
    )
    if (onward) {
      nextSignal = onward
      assistantContent = `${processFeedback === "corrects_assistant_assumption"
        ? "You're right; I shouldn't have assumed that. "
        : processFeedback === "requests_topic_change"
          ? "Of course—let's move on. "
          : ""}${fallbackQuestionForApplicationSignal(onward, { hasArtistAntecedent })}`
      interactionSpec = fallbackInteractionForApplicationSignal(onward)
      acceptedConversationMove = "advance"
      acceptedBridge = null
      moveWasAdjusted = true
      conversationalThreadTurn = false
    } else {
      status = forcedCloseStatusFromScores({ scores, passThreshold, rejectThreshold })
      structuredTerminal = terminalFieldForSessionStatus(status)
      acceptedConversationMove = "decide"
      nextSignal = null
    }
  }

  const openCulturalPointOfViewSignal = activeSignalDefinitions.find(
    (signal) =>
      signal.cluster === "cultural_point_of_view" &&
      !answersForRouting.some(
        (answer) => answer.key === signal.key && answer.covered !== false,
      ),
  )
  const shouldInsertColorsMediaQuestion =
    status === null &&
    colorsAdaptiveBranchesEnabled &&
    colorsMediaPilotEnabled(projectIdOverride, settings.raw) &&
    questionBudget.phase !== "emergency_stop" &&
    answeredQuestionCount >= 2 &&
    !input.interactionAnswer &&
    !turnIsClarificationRequest &&
    currentIntegrityConcerns.length === 0 &&
    !historyHasMediaChoice(priorHistory) &&
    Boolean(openCulturalPointOfViewSignal)

  if (shouldInsertColorsMediaQuestion && openCulturalPointOfViewSignal) {
    try {
      const shows = await timings.measure("colors_media_feed", () =>
        fetchLatestColorsShows(4),
      )
      const mediaQuestion = buildColorsMediaQuestion(shows, "remove")
      if (mediaQuestion) {
        assistantContent = mediaQuestion.message
        interactionSpec = {
          intent: "challenge",
          inputType: "mediaChoice",
          emotionalState: "curious",
          visualState: "interested",
          mediaChoice: mediaQuestion.interaction,
        }
        nextSignal = openCulturalPointOfViewSignal
        acceptedConversationMove = "challenge"
        acceptedBridge = null
        structuredTerminal = "none"
        reviewerReport = null
        conversationalThreadTurn = false
        colorsMediaQuestionInserted = true
      }
    } catch (error) {
      log.warn("colors_media_question_unavailable", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const explicitPrompt = ensureExplicitStructuredInputPrompt({
    reply: assistantContent,
    interaction: interactionSpec,
    nextSignal,
  })
  assistantContent = explicitPrompt.reply
  interactionSpec = explicitPrompt.interaction
  if (
    status === null &&
    input.interactionAnswer &&
    currentSignal?.cluster === "cultural_point_of_view" &&
    nextSignal?.key === currentSignal.key
  ) {
    colorsMediaDepthFollowup = true
  }
  if (status === null && useCompactSignalState) {
    const previousQuestions = priorHistory
      .filter((entry) => entry.role === "assistant")
      .slice(-6)
      .map((entry) => entry.content)
      .join("\n")
    const finalIssue = activeApplicationReplyIssue({
      reply: assistantContent,
      interaction: interactionSpec,
      closingMessage: applicationClosingMessage,
      previousQuestion: previousQuestions,
      hasArtistAntecedent,
    })
    if (finalIssue === "repeated_question" || finalIssue === "multiple_questions") {
      const alternatives = [
        ...(nextSignal?.promptRoutes ?? []),
        ...(!nextSignal
          ? ["What else would you want the Forum to understand about how you participate around music?"]
          : []),
      ]
      const alternative = alternatives.find((question) =>
        activeApplicationReplyIssue({
          reply: question,
          interaction: interactionSpec,
          closingMessage: applicationClosingMessage,
          previousQuestion: previousQuestions,
          hasArtistAntecedent,
        }) === null,
      )
      if (alternative) {
        assistantContent = repairApplicationReplyWithQuestion({
          reply: assistantContent,
          currentAnswer: message,
          question: alternative,
        }).reply
      }
    }
  }

  // Reconcile the final proposed question after every routing and reply repair.
  // Earlier audits missed participation when a late media-thread move chose it.
  if (
    status === null &&
    colorsAdaptiveBranchesEnabled &&
    !localTestMode &&
    questionBudget.phase !== "emergency_stop" &&
    !colorsMediaQuestionInserted
  ) {
    for (let auditCount = 0; auditCount < 4; auditCount += 1) {
      const candidate = nextSignal
      if (!candidate) break
      const candidateKind = candidate.kind
      const isParticipationOrContribution =
        candidateKind === "participation" || candidateKind === "contribution"
      const priorAttempt = storedSignalAnswers.find((answer) =>
        answer.key === candidate.key && answer.covered === false,
      )
      if (!isParticipationOrContribution &&
        (candidate.key === currentSignal?.key || !priorAttempt?.sources?.length)) break
      try {
        const sourceMessageId = await timings.measure(
          "prior_signal_audit",
          () => findPriorApplicationEvidence({
            kind: candidateKind,
            goal: candidate.goal,
            messages: turnIsProcessFeedback ? priorHistory : historyRows,
            ...(!isParticipationOrContribution
              ? { sourceMessageIds: priorAttempt?.sources?.map((source) => source.messageId) }
              : {}),
            requestId: input.requestId,
            organisationId,
            projectId,
            sessionId,
          }),
        )
        const source = sourceMessageId
          ? historyRows.find((entry) => entry.id === sourceMessageId && entry.role === "user")
          : null
        if (!source || !sourceMessageId) break
        answersWithCoverage = withCurrentSignalAnswer(
          answersWithCoverage,
          candidate,
          source.content,
          true,
          sourceMessageId,
        )
        answersForRouting = answersWithCoverage.map((answer) =>
          insufficientEvidenceKeys.has(answer.key)
            ? { ...answer, covered: true }
            : answer,
        )
        recoveredSignalEvidence.push({ signalKey: candidate.key, sourceMessageId })
        nextSignal = resolveNextApplicationSignal(
          null,
          activeSignalDefinitions.filter((signal) =>
            signal.key !== candidate.key && signal.key !== currentSignal?.key),
          answersForRouting,
          null,
        )
        acceptedBridge = null
        bridgeWasAdjusted = true
        moveWasAdjusted = true
        if (!nextSignal) {
          status = forcedCloseStatusFromScores({ scores, passThreshold, rejectThreshold })
          structuredTerminal = terminalFieldForSessionStatus(status)
          acceptedConversationMove = "decide"
          break
        }
        assistantContent = fallbackQuestionForApplicationSignal(nextSignal, { hasArtistAntecedent })
        interactionSpec = fallbackInteractionForApplicationSignal(nextSignal)
        acceptedConversationMove = "advance"
        conversationalThreadTurn = false
      } catch (error) {
        log.warn("prior_signal_audit_failed", {
          requestId: input.requestId,
          projectId,
          sessionId,
          detail: error instanceof Error ? error.message : String(error),
        })
        break
      }
    }
  }
  if (status === null && useCompactSignalState) {
    const finalReplyIssue = activeApplicationReplyIssue({
      reply: assistantContent,
      interaction: interactionSpec,
      closingMessage: applicationClosingMessage,
      hasArtistAntecedent,
    })
    if (finalReplyIssue === "unclear_invitation" || finalReplyIssue === "missing_invitation") {
      assistantContent = nextSignal
        ? fallbackQuestionForApplicationSignal(nextSignal, { hasArtistAntecedent })
        : "What would you want me to understand about that?"
      interactionSpec = nextSignal
        ? fallbackInteractionForApplicationSignal(nextSignal)
        : interactionSpecForApplicationMove("clarify", "none")
      acceptedBridge = null
      moveWasAdjusted = true
      activeReplyRepair = {
        issue: finalReplyIssue,
        action: "same_thread",
        ...(nextSignal ? { signalKey: nextSignal.key } : {}),
      }
    }
  }
  if (
    status === null &&
    colorsAdaptiveBranchesEnabled &&
    !localTestMode &&
    !turnIsProcessFeedback &&
    acceptedConversationMove !== "clarify" &&
    nextSignal?.kind === "recommendation" &&
    (interactionSpec.inputType === "text" || interactionSpec.inputType === "voice")
  ) {
    let aligned = false
    try {
      aligned = await timings.measure(
        "recommendation_question_alignment",
        () => recommendationQuestionMatchesGoal({
          reply: assistantContent,
          goal: nextSignal.goal,
          requestId: input.requestId,
          organisationId,
          projectId,
          sessionId,
        }),
      )
    } catch (error) {
      log.warn("recommendation_question_alignment_failed", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    if (!aligned) {
      assistantContent = repairApplicationReplyWithQuestion({
        reply: assistantContent,
        currentAnswer: message,
        question: fallbackQuestionForApplicationSignal(nextSignal, { hasArtistAntecedent }),
      }).reply
      interactionSpec = fallbackInteractionForApplicationSignal(nextSignal)
      activeReplyRepair = {
        issue: "signal_question_mismatch",
        action: "next_signal",
        signalKey: nextSignal.key,
      }
      moveWasAdjusted = true
    }
  }
  if (status !== null) {
    reviewerReport = ensureEvidenceBackedReviewerReport({
      report: reviewerReport,
      terminalStatus: status,
      scores,
      definitions: activeSignalDefinitions,
      answers: answersWithCoverage,
      messages: historyRows.map((entry) =>
        entry.id === userMsg.id
          ? {
              ...entry,
              metadata: {
                ...(input.interactionAnswer ? { interaction_answer: input.interactionAnswer } : {}),
                ...(answerAssessment ? { answer_assessment: answerAssessment } : {}),
                ...(answerRelation ? { application_answer_relation: answerRelation } : {}),
                ...(processFeedback !== "none"
                  ? { application_process_feedback: { kind: processFeedback, sourceMessageId: userMsg.id } }
                  : {}),
                ...(mediaClaim.kind !== "none"
                  ? { application_media_claim: { ...mediaClaim, sourceMessageId: userMsg.id } }
                  : {}),
                ...(currentSignal && !turnIsProcessFeedback
                  ? {
                      application_signal:
                        applicationSignalMetadata(currentSignal),
                    }
                  : {}),
              },
            }
          : entry,
      ),
      insufficientEvidenceKeys,
      integrityFlags: [
        ...storedIntegrityConcerns,
        ...currentIntegrityConcerns,
      ].map((concern) => concern.reviewerFlag),
      serverControlledFieldsOnly: colorsAdaptiveBranchesEnabled,
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
  const factSnapshot = collectApplicationFacts([
    ...priorHistory,
    {
      ...historyRows[historyRows.length - 1],
      metadata: {
        ...(input.interactionAnswer ? { interaction_answer: input.interactionAnswer } : {}),
        ...(answerRelation ? { application_answer_relation: answerRelation } : {}),
        ...(processFeedback !== "none"
          ? { application_process_feedback: { kind: processFeedback, sourceMessageId: userMsg.id } }
          : {}),
        ...(mediaClaim.kind !== "none"
          ? { application_media_claim: { ...mediaClaim, sourceMessageId: userMsg.id } }
          : {}),
      },
    },
    {
      role: "assistant",
      content: assistantContent,
      metadata: { ...(colorsMediaDepthFollowup ? { application_media_depth_followup: true } : {}) },
    },
  ])
  const assistantMetadata =
    structuredToolSeen && persistedTerminal !== null
      ? {
          gatekeeper_structured: true,
          gatekeeper_terminal: persistedTerminal,
          ui: interactionSpec,
          application_facts_v1: factSnapshot,
          ...(acceptedConversationMove
            ? { conversation_move: acceptedConversationMove }
            : {}),
          ...(moveWasAdjusted ? { conversation_move_adjusted: true } : {}),
          ...(explicitPrompt.added
            ? { application_explicit_question_added: true }
            : {}),
          ...(explicitPrompt.downgradedToText
            ? { application_structured_input_downgraded: true }
            : {}),
          ...(semanticConcernTerminalDeferred
            ? { application_semantic_concern_terminal_deferred: true }
            : {}),
          ...(openingClarification
            ? { application_opening_clarification: true }
            : {}),
          ...(colorsMediaQuestionInserted
            ? {
                application_media_question: {
                  source: "colors_official_playlist",
                  mode: "remove",
                  pilot: true,
                },
              }
            : {}),
          ...(colorsMediaDepthFollowup
            ? { application_media_depth_followup: true }
            : {}),
          ...(recoveredSignalEvidence.length
            ? { application_recovered_signal_evidence: recoveredSignalEvidence.length === 1
                ? recoveredSignalEvidence[0]
                : recoveredSignalEvidence }
            : {}),
          ...(conversationalThreadTurn
            ? { application_conversation_thread_turn: true }
            : {}),
          ...(turnNeedsConversationalRepair && answerRelation
            ? {
                application_turn_repair: {
                  relation: answerRelation.kind,
                  reason: answerRelation.reason,
                },
              }
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
                  source: "emergency_stop",
                  overall: scores.overall,
                  passThreshold,
                  rejectThreshold,
                  status,
                },
              }
            : {}),
          ...(calibratedIntegrityStatus
            ? {
                application_integrity_calibrated_outcome: {
                  concern:
                    currentIntegrityConcerns.find((concern) =>
                      storedIntegrityConcerns.some(
                        (stored) => stored.kind === concern.kind,
                      ),
                    ) ?? storedIntegrityConcerns.find(
                      (concern) => concern.kind === "admitted_fabrication",
                    ),
                  status: calibratedIntegrityStatus,
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
          ...(input.demoReviewerPreview && status !== null
            ? { colors_demo_report_status: "pending" }
            : {}),
          conversation_thread: updatedConversationThread,
          ...(nextSignal
            ? { application_next_signal: applicationSignalMetadata(nextSignal) }
            : {}),
        }
      : null

  const modelAssistantContent = applyNaturalLanguageStyle(assistantContent)
  const userVisibleAssistantContent =
    status !== null
      ? applyNaturalLanguageStyle(applicationClosingMessage)
      : modelAssistantContent

  const persistedAssistantMetadata =
    status !== null
      ? {
          ...(assistantMetadata ?? {}),
          gatekeeper_model_reply: modelAssistantContent,
          application_closing: true,
        }
      : assistantMetadata

  const { error: asstError } = await timings.measure("assistant_persistence", () => supabase.from("messages").insert({
    session_id: sessionRowId,
    organisation_id: organisationId,
    project_id: projectId,
    role: "assistant",
    content: userVisibleAssistantContent,
    ...(persistedAssistantMetadata ? { metadata: persistedAssistantMetadata } : {}),
  }))

  if (asstError) {
    log.error("assistant_message_insert_failed", {
      requestId: input.requestId,
      projectId,
      sessionId,
      detail: asstError.message,
    })
  }

  if (status !== null) {
    await timings.measure("terminal_state_persistence", () =>
      supabase
        .from("sessions")
        .update({ status, suitability_score: scores.overall })
        .eq("id", sessionRowId),
    )
  }

  let automaticDecision: AutomaticDecisionResult | null = null
  if (status !== null && !input.demoReviewerPreview) {
    try {
      automaticDecision = await timings.measure("client_decision_policy", () =>
        recordAutomaticApplicationDecision({
          organisationId,
          projectId,
          sessionId: sessionRowId,
          suitabilityScore: scores.overall,
          projectSettings: settings.raw,
          advisoryRecommendation:
            reviewerReport?.advisory_recommendation ?? null,
        }),
      )
    } catch (error) {
      log.error("automatic_application_decision_failed", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (status !== null && !input.demoReviewerPreview) {
    try {
      await timings.measure("terminal_job_enqueue", () => enqueueSessionCompletionJob({
        organisationId,
        projectId,
        sessionId: sessionRowId,
        likelyBot: botSignal.likelyBot,
      }))
      scheduleSessionCompletionDrain()
    } catch (err) {
      log.error("session_completion_enqueue_failed", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: err instanceof Error ? err.message : String(err),
      })
      try {
        await timings.measure("terminal_completion_fallback", () => completeSessionImmediately({
          organisationId,
          projectId,
          sessionId: sessionRowId,
          likelyBot: botSignal.likelyBot,
        }))
      } catch (fallbackError) {
        log.error("session_completion_fallback_failed", {
          requestId: input.requestId,
          projectId,
          sessionId,
          detail:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        })
      }
    }
  }

  return traceJson(input, {
    message: userVisibleAssistantContent,
    status: status ?? "active",
    reviewStatus:
      status === null ? "not_ready" : automaticDecision?.reviewStatus ?? "pending",
    scores,
    suitabilityScore: scores.overall,
    ...(automaticDecision
      ? { suitabilityBand: automaticDecision.suitabilityBand }
      : {}),
    ...(automaticDecision?.accessSecret
      ? { secret: automaticDecision.accessSecret }
      : {}),
    ...(structuredToolSeen ? { ui: interactionSpec } : {}),
    ...(reviewerReport && !input.demoReviewerPreview ? { reviewerReport } : {}),
  })
}
