import { randomUUID } from "crypto"
import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import { scoreMessage, type ConversationMessage } from "@/lib/scoring"
import {
  resolveProjectContext,
  touchApiKeyLastUsed,
} from "@/lib/project-resolution"
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
import { computeTerminalStatusFromGatekeeperTurn } from "@/lib/gatekeeper-session-status"
import {
  withTerminalDecisionAppendix,
} from "@/lib/terminal-decision-prompt"

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

You have already said "Hi." That's done.

Exchange 1 — They respond to "Hi." You respond. 
Exchange 2 — They answer. You probe what they actually care about. One question, nothing else.
Exchange 3 — They answer. You test whether they understand loss — what disappears, why it matters, what their presence costs. One question or observation.
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

const DOORMAN_SYSTEM_PROMPT = withTerminalDecisionAppendix(
  DOORMAN_SYSTEM_PROMPT_CORE,
)

const OPENING: Anthropic.MessageParam = {
  role: "assistant",
  content: "Hi.",
}

export type PostSessionMessageInput = {
  authorization: string | null
  sessionId: string
  message: string
  personaId?: string | null
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
  const { message, sessionId, personaId } = input
  if (!message?.trim() || !sessionId?.trim()) {
    return traceJson(
      input,
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  const projectResolved = await resolveProjectContext(input.authorization)
  if (!projectResolved.ok) {
    return traceJson(input, projectResolved.body, {
      status: projectResolved.status,
    })
  }
  const { organisationId, projectId, apiKeyId } = projectResolved.context

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
  if (apiKeyId) {
    touchApiKeyLastUsed(apiKeyId)
  }

  type PersonaRow = {
    id: string
    prompt: string
    pass_threshold: number
    reject_threshold: number
    profile_schema?: unknown
    profile_extractor_hint?: string | null
  }

  let defaultPersona: PersonaRow | null = null
  const personaCols =
    "id, prompt, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint"

  if (personaId) {
    const { data } = await supabase
      .from("personas")
      .select(personaCols)
      .eq("id", personaId)
      .eq("is_active", true)
      .single()
    defaultPersona = data as PersonaRow | null
  }

  if (!defaultPersona) {
    const { data } = await supabase
      .from("personas")
      .select(personaCols)
      .eq("is_active", true)
      .eq("is_default", true)
      .single()
    defaultPersona = data as PersonaRow | null
  }

  const baseSystem = defaultPersona
    ? withTerminalDecisionAppendix(defaultPersona.prompt)
    : DOORMAN_SYSTEM_PROMPT
  const systemPrompt = `${baseSystem}\n\n${GATEKEEPER_STRUCTURED_SYSTEM_SUFFIX}`
  const resolvedPersonaId: string | null = defaultPersona?.id ?? null
  const passThreshold: number = defaultPersona?.pass_threshold ?? 0.65
  const rejectThreshold: number = defaultPersona?.reject_threshold ?? 0.25

  let sessionRowId: string

  const { data: existing } = await supabase
    .from("sessions")
    .select("id, status")
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
    sessionRowId = existing.id
  } else {
    const { data: created, error: createError } = await supabase
      .from("sessions")
      .insert({
        session_id: sessionId,
        persona_id: resolvedPersonaId,
        organisation_id: organisationId,
        project_id: projectId,
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
    .select("role, content")
    .eq("session_id", sessionRowId)
    .order("sent_at", { ascending: true })

  const dbHistory: ConversationMessage[] = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }))

  const historyForScoring = dbHistory.slice(0, -1)
  const scorePromise = scoreMessage(message.trim(), historyForScoring)

  const claudeMessages: Anthropic.MessageParam[] = [
    OPENING,
    ...dbHistory.map((m) => ({ role: m.role, content: m.content })),
  ]

  let assistantContent = ""
  let structuredToolSeen = false
  let structuredTerminal: GatekeeperTerminalField | null = null
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 512,
      system: systemPrompt,
      messages: claudeMessages,
      tools: [gatekeeperResponseTool],
      tool_choice: { type: "tool", name: gatekeeperResponseTool.name },
    })

    const parsed = parseGatekeeperStructuredResponse(response.content)
    assistantContent = parsed.reply
    structuredToolSeen = parsed.toolSeen
    structuredTerminal = parsed.terminal

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

  const scores = await scorePromise
  await supabase
    .from("messages")
    .update({ metadata: { scores } })
    .eq("id", userMsg.id)

  const assistantMetadata =
    structuredToolSeen && structuredTerminal !== null
      ? {
          gatekeeper_structured: true,
          gatekeeper_terminal: structuredTerminal,
        }
      : null

  const { error: asstError } = await supabase.from("messages").insert({
    session_id: sessionRowId,
    organisation_id: organisationId,
    project_id: projectId,
    role: "assistant",
    content: assistantContent,
    ...(assistantMetadata ? { metadata: assistantMetadata } : {}),
  })

  if (asstError) {
    log.error("assistant_message_insert_failed", {
      requestId: input.requestId,
      projectId,
      sessionId,
      detail: asstError.message,
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
      { role: "assistant", content: assistantContent },
    ]
    try {
      const result = await recordVerdictAndEnqueueWebhooks({
        organisationId,
        projectId,
        sessionInternalId: sessionRowId,
        clientSessionKey: sessionId,
        terminalStatus: status,
        scores,
        persona: defaultPersona
          ? {
              profile_schema: defaultPersona.profile_schema ?? null,
              profile_extractor_hint: defaultPersona.profile_extractor_hint ?? null,
            }
          : null,
        transcript: transcriptForExtraction,
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
    message: assistantContent,
    status: status ?? "active",
    scores,
    ...(successSecret ? { secret: successSecret } : {}),
    ...(profile ? { profile } : {}),
  })
}
