import { randomUUID } from "crypto"
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
import { botSignalFromHeaders } from "@/lib/bot-signals"
import { recordVerdictAndEnqueueWebhooks } from "@/lib/verdict-webhook"
import {
  gatekeeperResponseTool,
  GATEKEEPER_STRUCTURED_SYSTEM_SUFFIX,
  parseGatekeeperStructuredResponse,
  type GatekeeperTerminalField,
} from "@/lib/gatekeeper-structured-tool"
import { DEFAULT_INTERACTION_SPEC } from "@/lib/gatekeeper-interaction-spec"
import { computeTerminalStatusFromGatekeeperTurn } from "@/lib/gatekeeper-session-status"
import { postOnboardingMessage } from "@/lib/post-onboarding-message"
import {
  withTerminalDecisionAppendix,
} from "@/lib/terminal-decision-prompt"
import { buildApplicationExperiencePromptAppendix } from "@/lib/application-experience-prompt"
import { DEFAULT_APPLICATION_CLOSING_MESSAGE } from "@/lib/project-settings"
import { gatekeeperConversationModel } from "@/lib/gatekeeper-models"
import {
  applicationSignalDefinitions,
  applicationSignalMetadata,
  buildCompactApplicationStateMessage,
  collectApplicationSignalAnswers,
  expectedApplicationSignal,
  hasLegacyUntaggedAnswers,
  resolveNextApplicationSignal,
  withCurrentSignalAnswer,
  type ApplicationSignalMessage,
} from "@/lib/application-signal-state"

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

  const openingMessage = settings.applicationExperience.opening_message

  const { data: existing } = await supabase
    .from("sessions")
    .select("id, status, persona_id, applicant_email, applicant_name")
    .eq("session_id", sessionId)
    .eq("project_id", projectId)
    .maybeSingle()

  if (existing) {
    if (
      ["passed", "failed", "redirected", "rejected"].includes(existing.status)
    ) {
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
    .select("role, content, metadata")
    .eq("session_id", sessionRowId)
    .order("sent_at", { ascending: true })

  const historyRows: ApplicationSignalMessage[] = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    metadata: m.metadata,
  }))
  const dbHistory: ConversationMessage[] = historyRows.map(({ role, content }) => ({
    role,
    content,
  }))

  const priorHistory = historyRows.slice(0, -1)
  const signalDefinitions = applicationSignalDefinitions(
    settings.applicationExperience.required_signals,
  )
  const storedSignalAnswers = collectApplicationSignalAnswers(
    priorHistory,
    signalDefinitions,
  )
  const useCompactSignalState =
    signalDefinitions.length > 0 &&
    !hasLegacyUntaggedAnswers(priorHistory, signalDefinitions)
  const currentSignal = useCompactSignalState
    ? expectedApplicationSignal(
        priorHistory,
        signalDefinitions,
        storedSignalAnswers,
      )
    : null
  const compactSignalAnswers = withCurrentSignalAnswer(
    storedSignalAnswers,
    currentSignal,
    message.trim(),
  )

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

  const previousAssistant = [...priorHistory]
    .reverse()
    .find((entry) => entry.role === "assistant")
  const currentQuestion = previousAssistant?.content ?? effectiveOpeningMessage
  const claudeMessages: Anthropic.MessageParam[] = useCompactSignalState
    ? [
        {
          role: "user",
          content: buildCompactApplicationStateMessage({
            definitions: signalDefinitions,
            answers: compactSignalAnswers,
            currentSignal,
            currentQuestion,
            currentAnswer: message.trim(),
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
  let interactionSpec = DEFAULT_INTERACTION_SPEC
  let scores: Score = {
    specificity: 0.5,
    authenticity: 0.5,
    cultural_depth: 0.5,
    overall: 0.5,
  }
  try {
    const response = await client.messages.create({
      model: gatekeeperConversationModel(),
      max_tokens: 256,
      system: systemPrompt,
      messages: claudeMessages,
      tools: [gatekeeperResponseTool],
      tool_choice: { type: "tool", name: gatekeeperResponseTool.name },
    })

    const parsed = parseGatekeeperStructuredResponse(response.content)
    assistantContent = parsed.reply
    structuredToolSeen = parsed.toolSeen
    structuredTerminal = parsed.terminal
    parsedNextSignalKey = parsed.nextSignalKey
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

  const { error: userMetadataError } = await supabase
    .from("messages")
    .update({
      metadata: {
        scores,
        ...(useCompactSignalState && currentSignal
          ? { application_signal: applicationSignalMetadata(currentSignal) }
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

  const status = computeTerminalStatusFromGatekeeperTurn({
    assistantContent,
    scores,
    passThreshold,
    rejectThreshold,
    structuredTerminal,
    structuredToolUsed: structuredToolSeen,
  })
  const nextSignal =
    status === null && useCompactSignalState
      ? resolveNextApplicationSignal(
          parsedNextSignalKey,
          signalDefinitions,
          compactSignalAnswers,
          currentSignal,
        )
      : null
  const assistantMetadata =
    structuredToolSeen && structuredTerminal !== null
      ? {
          gatekeeper_structured: true,
          gatekeeper_terminal: structuredTerminal,
          ui: interactionSpec,
          ...(nextSignal
            ? { application_next_signal: applicationSignalMetadata(nextSignal) }
            : {}),
        }
      : null

  const modelAssistantContent = assistantContent
  const applicationClosingMessage =
    settings.applicationExperience.closing_message?.trim() ||
    DEFAULT_APPLICATION_CLOSING_MESSAGE
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

  let successSecret: string | null = null
  if (status === "passed") {
    successSecret = randomUUID()
    await supabase
      .from("sessions")
      .update({ status, success_secret: successSecret })
      .eq("id", sessionRowId)
  } else if (status !== null) {
    await supabase.from("sessions").update({ status }).eq("id", sessionRowId)
  }

  let profile: Awaited<ReturnType<typeof recordVerdictAndEnqueueWebhooks>>["profile"] = null
  if (status !== null) {
    const transcriptForExtraction: ConversationMessage[] = [
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
  }

  return traceJson(input, {
    message: userVisibleAssistantContent,
    status: status ?? "active",
    scores,
    ...(structuredToolSeen ? { ui: interactionSpec } : {}),
    ...(successSecret ? { secret: successSecret } : {}),
    ...(profile ? { profile } : {}),
  })
}
