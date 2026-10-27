import { ARTIST_APPLICATION_CONTEXT, COMMUNITY_APPLICATION_CONTEXT } from "@/lib/artist-application"
import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import type { ApplicantIdentity } from "@/lib/applicant-identity"
import { COLORS_FORUM_PERSONA_PROMPT } from "@/lib/colors-forum-persona"
import { COLORS_FORUM_MEMBERSHIP_CONTEXT, COLORS_FORUM_MEMBERSHIP_OBJECTIVE } from "@/lib/colors-forum-membership-brief"
import { fetchLatestColorsShows } from "@/lib/colors-youtube-feed"
import {
  colorsInteractionCatalog,
  resolveApplicationRichInteraction,
} from "@/lib/application-rich-interaction"
import {
  DEFAULT_INTERACTION_SPEC,
  normaliseMediaChoiceInteraction,
  type MediaChoiceAnswer,
} from "@/lib/gatekeeper-interaction-spec"
import { colorsThinConversationModel, supportsForcedToolChoice } from "@/lib/gatekeeper-models"
import { queueSessionCompletion } from "@/lib/session-completion-jobs"
import { logLlmUsage } from "@/lib/llm-usage"
import { log } from "@/lib/logger"
import type { ProjectContext } from "@/lib/project-resolution"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import { DEFAULT_APPLICATION_CLOSING_MESSAGE } from "@/lib/project-settings"

import { applicantAsksQuestion, COLORS_THIN_PILOT_MARKER } from "@/lib/colors-engine"
export { applicantAsksQuestion, COLORS_THIN_PILOT_MARKER }

type ConversationReply = {
  reply: string
  close: boolean
  boundary: "none" | "consent" | "safety"
  boundaryQuestion: string
  interactionProposal?: unknown
  addsNewContext?: boolean
}

/**
 * The reply text so far from a partial JSON object such as `{"reply":"Sunday swaps sou`.
 * Used to stream schema-constrained JSON output, where no parsed snapshot is available.
 */
export function partialReplyFromJson(partial: string): string | undefined {
  const match = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)(\\?)/.exec(partial)
  if (!match) return undefined
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    // A partly received escape such as \u00 cannot be decoded yet.
    return undefined
  }
}

/** Neutral placeholder for the API's required per-turn scores; see the completion job for suitability. */
export const UNSCORED_TURN = { specificity: 0.5, authenticity: 0.5, cultural_depth: 0.5, overall: 0.5 } as const

/** Used when the model raises a consent boundary without a usable consent question. */
export const DEFAULT_CONSENT_QUESTION = "Would you ask the artist for permission before sharing anything of theirs that isn't public?"
export const DEFAULT_CONSENT_STATEMENT = "Sharing someone else's unreleased or private work without their permission isn't something the Forum allows."

export function isConsentQuestion(question: string): boolean {
  return question.trim().endsWith("?") && /\b(?:consent|permission|ask|agree|approval)\b/i.test(question)
}

/** From this many applicant answers, Groucho is told to wrap up unless something genuinely new is open. */
export const WRAP_UP_ANSWERS = 5
/** At this many applicant answers the runtime closes, unless the applicant has just asked a question or a boundary is open. */
export const SOFT_CLOSE_ANSWERS = 7

export const colorsThinResponseTool = {
  name: "groucho_converse",
  description: "Choose the next applicant-facing turn. Do not assess or score the applicant.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
      addsNewContext: { type: "boolean", description: "Whether this applicant answer adds a relevant fact, preference, example, correction or question not already understood. Repeating the same hope or saying they do not know adds no new context. This is conversational progress, never an applicant score." },
      close: { type: "boolean" },
      boundary: { type: "string", enum: ["none", "consent", "safety"] },
      boundaryQuestion: { type: "string" },
      interactionProposal: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["none", "reference", "choice"] },
          format: { type: "string", enum: ["image", "link", "video"] },
          assetIds: { type: "array", items: { type: "string" }, maxItems: 4 },
          mode: { type: "string", enum: ["select", "remove", "rank"] },
          question: { type: "string" },
          rationalePrompt: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["kind", "format", "assetIds", "mode", "question", "rationalePrompt", "purpose"],
      },
    },
    required: ["reply", "close", "boundary", "boundaryQuestion", "addsNewContext"],
  },
} as const satisfies Anthropic.Tool

function strictJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictJsonSchema)
  if (!node || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === "maxItems") continue // not accepted by structured outputs; the server validates media IDs
    out[key] = strictJsonSchema(value)
  }
  if (out.type === "object") out.additionalProperties = false
  return out
}

/** The same fields as the groucho_converse tool, for models that use structured JSON output. */
export const COLORS_THIN_OUTPUT_SCHEMA = strictJsonSchema(colorsThinResponseTool.input_schema) as Record<string, unknown>

export function colorsThinConversationPrompt(input: {
  applicationAudience?: "community" | "artist"
  hasApplicantDetails?: boolean
  objective: string
  turnCount: number
  mediaCatalog: ReturnType<typeof colorsInteractionCatalog>
}): string {
  return `${COLORS_FORUM_PERSONA_PROMPT.split("\n\nMake a private advisory judgment for COLORS.")[0]}

Current project objective: ${input.objective}
${input.applicationAudience === "artist" ? ARTIST_APPLICATION_CONTEXT : input.hasApplicantDetails ? COMMUNITY_APPLICATION_CONTEXT : ""}

${COLORS_FORUM_MEMBERSHIP_CONTEXT}

Give this conversation a loose arc: learn why the person wants to join; hear one concrete thread about COLORS, music, a scene, or another community; understand how they show up with others and what they hope to find or do in this Forum; follow the most revealing detail once; then close. These are purposes, not required questions or a fixed order. An answer may cover several purposes. Skip what is already understood. Make room for their actual COLORS relationship, which may include a favourite show or artist, a general impression, or no prior familiarity. Learn whether music is something they make, listen to, discuss, discover or experience with a scene; none is a higher-status answer. Online and offline communities matter equally. When someone mentions a group, event or scene, follow an interesting detail to understand what they themselves do with other people: how they bring people together, join in, respond or keep an exchange going. Do not redirect an offline story into an online-community check. If their role is already clear, move on. How they would like to participate in the Forum at first helps welcome them, not score them. If a real community story includes a different musical perspective, notice what happened without staging a disagreement test. Once a story already shows how they participate, move toward their COLORS connection or Forum hope rather than asking them to recall a song title, event name, lineup, frequency or another example. Do not ask a second example just to fill a category or keep probing the motive for ordinary sharing.

TONES is an optional branch when the person mentions it or their story naturally turns to COLORS live events, local scenes or gathering people in a city. Follow what they actually know or experienced. Do not introduce TONES as a final check, after signaling that the conversation is wrapping up, or just because there is room for another question. If it does not come up naturally, leave familiarity unknown. If you ask about it, first find out whether they know it; explain it only if they say no or ask. Use only the approved TONES description above, without embellishment. Do not treat recognition or attendance as proof of fit, require a favourite show, or invent event details.

Speak as Groucho, not as a reviewer. Respond to a specific detail, then ask one clear question at most. Every non-closing text turn must end with one direct question ending in ?. If there is no question worth asking and the exchange has naturally reached an end, set close=true. Vary the wording and route with the person. Do not announce stages, score, classify evidence, or mention an application checklist. A request to clarify or change topic deserves a direct response. Sharing public music links and discussing artists are ordinary Forum activity. Never ask for artist permission because someone shares or recommends music, and never introduce a copyright, remixing or reposting test. If the applicant independently proposes exposing someone else's private material, state the privacy boundary plainly; do not generalise that situation into a test for everyone. Set boundary to consent or safety only for a concrete concern raised in the applicant's own words. Otherwise boundaryQuestion must be empty.

Mark addsNewContext from what this answer actually adds to the conversation, not its length or fluency. A concise new fact counts. Rewording a hope already understood, another vague preference, or saying they do not know is not new context. Short non-committal answers such as "not really", "hard to say", "just vibes" or "I don't know yet" add no new context, even when worded differently each time. After one useful clarification, accept remaining uncertainty: switch to a genuinely different useful topic or close. Do not ask another version of what makes feedback useful or what the person wants if they already answered. Do not ask questions merely to make a brief applicant become articulate.

Pacing (internal only): the applicant has given ${input.turnCount} answer(s). Never mention numbers, turns, stages, how far along the conversation is, or how much you have learned. Most conversations should close after 3 to 5 applicant answers. Close as soon as you understand three things: why they want to join, one concrete thread about their music, COLORS or a community, and how they would take part or what they hope to find. Also close when an answer adds nothing new after one clarification. A thread that could be deepened further is not a reason to continue once those three are understood. On close, write one short sentence that reflects the person's actual point, with no question, verdict, promise, generic farewell, or comment about having enough information. The runtime adds the neutral final line.

Approved media catalog: ${JSON.stringify(input.mediaCatalog)}. Media is optional. Offer it only when it helps this person's current thread or they ask to see a source. Use only listed IDs. Never imply they watched or understood an asset before they say so. A reference uses one or two image/link cards; a choice uses two to four videos with a rationale. The reply must still make sense if media cannot be shown. Omit interactionProposal for an ordinary text turn or an unresolved boundary.

Turn-routing priority: a favourite COLORS SHOW is a recorded performance, not evidence of attending an event. When someone names a show or artist, follow what they heard, felt or remember if that detail is still open; otherwise move to their music, community or Forum thread. Do not suggest live attendance as an alternative or ask whether they attended unless they themselves introduce a live event. Do not seek event names, dates or lineups to validate what they say. This guides the purpose of a question, not its wording.

Reply format (highest priority on every ordinary turn):
- At most two sentences and at most 40 words in total.
- First sentence: reflect one specific detail from their last answer in plain words. No praise, no summary of everything they have said.
- Second sentence: one short open question ending in ?.
- Never put options inside the question. No "or", no list of examples, no "or something else".
  Bad: "Would you want a short written note, or a longer talk about it?"
  Good: "How would you like to hear people's reactions?"
- If the applicant asked you something, answer it plainly first; you may use one extra sentence for that. Never promise Forum features, who will join or what will happen there.
Show warmth through attention, not by endorsing the person as right for the Forum.

Call groucho_converse exactly once. The reply is applicant-facing. close means the conversation is finished, not that an applicant has passed or failed. On close, the runtime appends the neutral closing message.`
}

function json(body: unknown, requestId?: string, status = 200) {
  const headers = new Headers()
  if (requestId) headers.set(REQUEST_ID_HEADER, requestId)
  return NextResponse.json(body, { status, headers })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

/** End an active text turn at its first question so the invitation stays clear. */
export function oneQuestion(reply: string): string {
  const first = reply.indexOf("?")
  return first >= 0
    ? reply.slice(0, first + 1).trim()
    : reply
}


/** A close may acknowledge the last answer, but must never imply a decision. */
export function conversationalClosing(acknowledgment: string, neutralLine: string): string {
  const unsafe = /\?|\b(?:accepted|approved|rejected|declined|passed|failed|qualified|unqualified|application|review|decision|proceed)\b|\b(?:good|great|perfect|strong|poor|bad)\s+(?:fit|match)\b|\bwelcome\s+(?:to|in)\b|\b(?:we(?:'d| would)? love to have you|you(?:'re| are) in|enough (?:to|for)|move forward|take (?:this|things) forward|no space|not (?:a place|for)|isn't (?:set up|for|a place))\b/i
  const generic = /^(?:i appreciate (?:your |the )?(?:directness|honesty)|thanks for (?:being )?(?:direct|honest)|i hear you|that's clear)\.?$/i
  const detail = acknowledgment.trim().replace(/\s+/g, " ")
    .split(/(?<=[.!])\s+/)
    .find((sentence) => !unsafe.test(sentence) && !generic.test(sentence))
  if (!detail || detail === neutralLine || detail.length > 180) {
    return neutralLine
  }
  return `${detail}\n\n${neutralLine}`
}

export async function postColorsThinConversation(input: {
  context: ProjectContext
  sessionId: string
  message: string
  applicant?: ApplicantIdentity
  interactionAnswer?: MediaChoiceAnswer
  requestId?: string
  /**
   * Receives the applicant-facing reply text as it is generated, cut at its first question.
   * Called only on turns where the runtime cannot force a close, so streamed text is not
   * later replaced by a closing line. The final JSON response stays authoritative.
   */
  onReplyDelta?: (text: string) => void
  /** A model chosen from COLORS_THIN_CONVERSATION_MODEL_OPTIONS; callers validate it first. */
  modelOverride?: string
  /** From the request's bot signals; recorded on the completion job. */
  likelyBot?: boolean
  /**
   * Run the completion pipeline (report, score, decision policy, verdict, webhooks) when the
   * conversation closes. The demo turns this off, as the old engine does for reviewer previews,
   * so test conversations never reach the client's webhooks.
   */
  runCompletion?: boolean
}): Promise<NextResponse> {
  const { organisationId, projectId, settings } = input.context
  const { data: session, error: sessionError } = await supabase.from("sessions")
    .select("id, status, applicant_email, applicant_details, application_audience")
    .eq("session_id", input.sessionId)
    .eq("organisation_id", organisationId)
    .eq("project_id", projectId)
    .maybeSingle()
  if (sessionError) return json({ error: "Session unavailable" }, input.requestId, 503)
  if (!session) return json({ error: "Session not found" }, input.requestId, 404)
  if (session.status !== "active") return json({ error: "Session concluded" }, input.requestId, 409)
  // Later API turns may omit the applicant; when present it must match the session's identity.
  if (input.applicant && session.applicant_email !== input.applicant.email) {
    return json({ error: "Applicant identity does not match this session" }, input.requestId, 409)
  }

  const { data: history, error: historyError } = await supabase.from("messages")
    .select("id, role, content, metadata")
    .eq("session_id", session.id)
    .order("sent_at", { ascending: true })
  if (historyError || !history?.length) return json({ error: "Transcript unavailable" }, input.requestId, 503)
  if (record(history[0].metadata).conversation_engine !== COLORS_THIN_PILOT_MARKER) {
    return json({ error: "Session uses a different conversation engine" }, input.requestId, 409)
  }
  const lastAssistant = [...history].reverse().find((entry) => entry.role === "assistant")
  const lastUi = record(record(lastAssistant?.metadata).ui)
  const expectedChoice = normaliseMediaChoiceInteraction(lastUi.mediaChoice)
  if (input.interactionAnswer && (!expectedChoice ||
    input.interactionAnswer.questionId !== expectedChoice.id ||
    input.interactionAnswer.mode !== expectedChoice.selection.mode ||
    input.interactionAnswer.optionIds.length < expectedChoice.selection.minSelections ||
    input.interactionAnswer.optionIds.length > expectedChoice.selection.maxSelections ||
    new Set(input.interactionAnswer.optionIds).size !== input.interactionAnswer.optionIds.length ||
    (expectedChoice.rationale.required && !input.interactionAnswer.rationale?.trim()) ||
    input.interactionAnswer.optionIds.some((id) => !expectedChoice.options.some((option) => option.id === id)))) {
    return json({ error: "Interaction answer does not match the current question" }, input.requestId, 400)
  }

  const turnCount = history.filter((entry) => entry.role === "user").length + 1
  const configuredMaxTurns = Math.max(1, settings.applicationExperience.max_turns ?? 9)
  const emergencyLimit = Math.min(12, Math.max(8, configuredMaxTurns + 3))
  const hasShownMedia = history.some((entry) => {
    const ui = record(record(entry.metadata).ui)
    return Boolean(ui.mediaChoice || ui.referenceCards)
  })
  let shows: Awaited<ReturnType<typeof fetchLatestColorsShows>> = []
  if (!hasShownMedia && turnCount > 1) {
    try {
      shows = await fetchLatestColorsShows(4)
    } catch (error) {
      log.warn("colors_thin_media_unavailable", {
        requestId: input.requestId,
        sessionId: input.sessionId,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const currentAnswer = input.interactionAnswer
    ? `${input.message}\nMedia choice: ${JSON.stringify(input.interactionAnswer)}`
    : input.message
  const applicantQuestion = applicantAsksQuestion(input.message)
  const conversation = history.filter((entry) => entry.role === "assistant" || entry.role === "user")
    .slice(-20).map((entry) => ({
      role: entry.role as "assistant" | "user",
      content: entry.content as string,
    }))
  const model = input.modelOverride?.trim() || colorsThinConversationModel()
  const previousProgress = [...history].reverse().filter(entry => entry.role === "assistant")
  let quietTurns = 0
  for (const entry of previousProgress) {
    if (record(record(entry.metadata).conversation_progress).adds_new_context !== false) break
    quietTurns += 1
  }
  const system = colorsThinConversationPrompt({
    applicationAudience: session.application_audience === "artist" ? "artist" : "community",
    hasApplicantDetails: Boolean(session.applicant_details),
    objective: COLORS_FORUM_MEMBERSHIP_OBJECTIVE,
    turnCount,
    mediaCatalog: colorsInteractionCatalog(shows),
  }) + `\n\nPrevious consecutive answers without new context: ${quietTurns}. A genuine applicant question always deserves an answer. Do not re-probe something they have already said they cannot explain.`

  async function requestReply(operation: string, instruction: string, maxTokens = 600,
    onReply?: (text: string) => void): Promise<ConversationReply> {
    const forcedTool = supportsForcedToolChoice(model)
    const base = {
      model, max_tokens: maxTokens,
      system: system + "\n\n" + instruction + (forcedTool ? "" : "\n\nReturn the groucho_converse fields as one JSON object."),
      messages: [...conversation, { role: "user" as const, content: currentAnswer }],
    }
    const request = forcedTool
      ? { ...base, tools: [colorsThinResponseTool], tool_choice: { type: "tool" as const, name: colorsThinResponseTool.name } }
      : { ...base, output_config: { format: { type: "json_schema" as const, schema: COLORS_THIN_OUTPUT_SCHEMA } } }
    const client = new Anthropic({ maxRetries: 1, timeout: 45000 })
    let response: Anthropic.Message
    if (onReply) {
      let shown = ""
      const show = (reply: unknown) => {
        if (typeof reply !== "string") return
        const visible = oneQuestion(reply.trimStart())
        if (visible.length > shown.length && visible.startsWith(shown)) {
          shown = visible
          onReply(visible)
        }
      }
      const stream = client.messages.stream(request as Anthropic.MessageCreateParamsNonStreaming)
      if (forcedTool) stream.on("inputJson", (_partial, snapshot) => show(record(snapshot).reply))
      else stream.on("text", (_delta, snapshot) => show(partialReplyFromJson(snapshot)))
      response = await stream.finalMessage()
    } else {
      response = await client.messages.create(request as Anthropic.MessageCreateParamsNonStreaming)
    }
    await logLlmUsage({ operation, provider: "anthropic", model, usage: response.usage,
      providerResponseId: response.id, requestId: input.requestId, organisationId, projectId, sessionId: input.sessionId })
    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") throw new Error(`Conversation model stopped: ${response.stop_reason}`)
    let value: Record<string, unknown>
    if (forcedTool) {
      const call = response.content.find(block => block.type === "tool_use" && block.name === colorsThinResponseTool.name)
      if (!call || call.type !== "tool_use") throw new Error("Conversation tool response missing")
      value = record(call.input)
    } else {
      const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("")
      try {
        value = record(JSON.parse(text))
      } catch {
        throw new Error("Conversation tool response malformed")
      }
    }
    if (typeof value.reply !== "string" || !value.reply.trim() || typeof value.close !== "boolean" ||
      !["none", "consent", "safety"].includes(String(value.boundary)) || typeof value.boundaryQuestion !== "string") {
      throw new Error("Conversation tool response malformed")
    }
    return { reply: value.reply.trim(), close: value.close, boundary: value.boundary as ConversationReply["boundary"],
      boundaryQuestion: value.boundaryQuestion.trim(), interactionProposal: value.interactionProposal,
      ...(typeof value.addsNewContext === "boolean" ? { addsNewContext: value.addsNewContext } : {}) }
  }
  function hasQuestion(reply: ConversationReply): boolean {
    const rich = reply.boundary === "none" ? resolveApplicationRichInteraction(reply.interactionProposal, shows) : null
    return reply.boundary === "consent" && reply.boundaryQuestion.endsWith("?") ||
      oneQuestion(rich?.question ?? reply.reply).includes("?")
  }
  const questionInstruction = "The applicant asked a direct question. Answer it using only approved Forum context, saying what is unknown when needed. Do not restate their question. Set close=false and finish with one relevant open question."
  let proposal: ConversationReply
  let addsNewContext: boolean | undefined
  let stopReason: "no_new_context" | "soft_limit" | "emergency_limit" | undefined
  try {
    const forcedClosePossible = !applicantQuestion &&
      (turnCount >= SOFT_CLOSE_ANSWERS || turnCount >= emergencyLimit || (turnCount >= 3 && quietTurns >= 1))
    const streamReply = forcedClosePossible ? undefined : input.onReplyDelta
    proposal = await requestReply("colors_thin_conversation", applicantQuestion ? questionInstruction :
      turnCount >= emergencyLimit ? "The emergency conversation limit is reached. Acknowledge the latest point and close neutrally without a question or decision." :
        turnCount >= WRAP_UP_ANSWERS ? "The conversation is ready to wrap up. Close now unless the latest answer opened something genuinely new that you do not yet understand. Never continue only to deepen a thread." :
          "Continue only if a useful thread remains; otherwise close naturally.", undefined, streamReply)
    addsNewContext = applicantQuestion ? true : proposal.addsNewContext
    const stalled = turnCount >= 3 && addsNewContext === false && quietTurns >= 1
    const softLimitReached = turnCount >= SOFT_CLOSE_ANSWERS
    if (!applicantQuestion && proposal.boundary === "none" && (stalled || softLimitReached || turnCount >= emergencyLimit)) {
      stopReason = turnCount >= emergencyLimit ? "emergency_limit" : stalled ? "no_new_context" : "soft_limit"
      // Formatting repairs must not turn a settled exchange into another interview.
      proposal = { ...proposal, close: true, interactionProposal: undefined }
    }
    const needsRepair = !stopReason && (applicantQuestion && (proposal.close || !hasQuestion(proposal)) ||
      !applicantQuestion && !proposal.close && proposal.boundary === "none" && !hasQuestion(proposal))
    if (needsRepair) {
      let usable = false
      let feedback = ""
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const repaired = await requestReply(applicantQuestion ? "colors_thin_question_reply_repair" : "colors_thin_active_question_repair",
            (applicantQuestion ? questionInstruction : "The previous active reply had no question. Ask one useful open question if a real thread remains, or set close=true if the exchange is settled. Do not continue for formatting alone.") + feedback)
          if (applicantQuestion ? repaired.close || !hasQuestion(repaired) : !repaired.close && !hasQuestion(repaired)) {
            feedback = "\nThe last repair was unusable. " + (applicantQuestion ? "It must answer the question, set close=false, and include one direct question ending in ?." : "Set close=true for a settled exchange; otherwise include one direct question ending in ?.")
            continue
          }
          proposal = repaired
          usable = true
          break
        } catch (error) {
          feedback = `\nThe last repair could not be used (${error instanceof Error ? error.message : "invalid response"}). Return the complete required tool with a usable reply.`
        }
      }
      if (!usable) throw new Error("Conversation repair exhausted")
    }
    // The closing acknowledgment is cosmetic. Rather than spend another model round trip on it,
    // conversationalClosing keeps the first safe reflective sentence of this reply, or falls back
    // to the neutral closing line alone.
  } catch (error) {
    log.error("colors_thin_conversation_failed", { requestId: input.requestId, sessionId: input.sessionId, detail: error instanceof Error ? error.message : String(error) })
    return json({ error: "Groucho could not respond. Please try again.", retryable: true }, input.requestId, 503)
  }

  const previousBoundary = record(lastAssistant?.metadata).boundary
  const firstBoundaryTurn = proposal.boundary === "consent" && previousBoundary !== "consent"
  const repeatedConsentBoundary = proposal.boundary === "consent" && previousBoundary === "consent"
  const requestedClose = !applicantQuestion && !firstBoundaryTurn &&
    (proposal.close || repeatedConsentBoundary || turnCount >= emergencyLimit)
  // A consent boundary must end with a clear consent question. If the model's wording misses,
  // use a fixed one rather than failing the applicant's turn.
  let boundaryQuestion = proposal.boundaryQuestion
  if (firstBoundaryTurn && !isConsentQuestion(boundaryQuestion)) {
    log.warn("colors_thin_boundary_question_replaced", {
      requestId: input.requestId, sessionId: input.sessionId,
    })
    boundaryQuestion = DEFAULT_CONSENT_QUESTION
  }
  const rich = !requestedClose && proposal.boundary === "none"
    ? resolveApplicationRichInteraction(proposal.interactionProposal, shows)
    : null
  const close = requestedClose
  if (!close && !firstBoundaryTurn && !oneQuestion(rich?.question ?? proposal.reply).includes("?")) {
    log.error("colors_thin_active_reply_question_missing", {
      requestId: input.requestId, sessionId: input.sessionId, turnCount,
    })
    return json({ error: "Groucho could not respond. Please try again." }, input.requestId, 503)
  }
  const activeRich = close ? null : rich
  const ui = activeRich?.kind === "reference"
    ? { ...DEFAULT_INTERACTION_SPEC, inputType: "text" as const, referenceCards: activeRich.cards }
    : activeRich?.kind === "choice"
      ? { ...DEFAULT_INTERACTION_SPEC, inputType: "mediaChoice" as const, mediaChoice: activeRich.interaction }
      : DEFAULT_INTERACTION_SPEC
  const boundaryStatement = proposal.reply.split(/\n\s*\n/)[0]
    .replace(/\s*[^.!?]*\?[\s\S]*$/, "").trim()
  const reply = close
    ? conversationalClosing(
      proposal.reply,
      settings.applicationExperience.closing_message?.trim() || DEFAULT_APPLICATION_CLOSING_MESSAGE,
    )
    : firstBoundaryTurn
      ? `${boundaryStatement || DEFAULT_CONSENT_STATEMENT} ${boundaryQuestion}`.trim()
      : oneQuestion(activeRich?.question ?? proposal.reply)

  const { data: savedUser, error: userError } = await supabase.from("messages").insert({
    session_id: session.id,
    organisation_id: organisationId,
    project_id: projectId,
    role: "user",
    content: input.message,
    metadata: {
      conversation_engine: COLORS_THIN_PILOT_MARKER,
      ...(input.interactionAnswer ? { interaction_answer: input.interactionAnswer } : {}),
    },
  }).select("id").single()
  if (userError || !savedUser) return json({ error: "Message could not be saved" }, input.requestId, 503)
  if (close) {
    const { data: closedSession, error: closeError } = await supabase.from("sessions")
      .update({ status: "completed" })
      .eq("id", session.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle()
    if (closeError || !closedSession) {
      await supabase.from("messages").delete().eq("id", savedUser.id)
      log.error("colors_thin_close_failed", {
        requestId: input.requestId,
        sessionId: input.sessionId,
        detail: closeError?.message ?? "Session state changed before close",
      })
      return json({ error: "Conversation could not be closed" }, input.requestId, 503)
    }
  }
  const { error: assistantError } = await supabase.from("messages").insert({
    session_id: session.id,
    organisation_id: organisationId,
    project_id: projectId,
    role: "assistant",
    content: reply,
    metadata: {
      conversation_engine: COLORS_THIN_PILOT_MARKER,
      ui,
      boundary: proposal.boundary,
      conversation_progress: { ...(addsNewContext === undefined ? {} : { adds_new_context: addsNewContext }), ...(stopReason ? { stop_reason: stopReason } : {}) },
      conversation_model: model,
      ...(rich ? { application_rich_interaction: {
        kind: rich.kind,
        purpose: rich.purpose,
      } } : {}),
      ...(close ? { application_closing: true, colors_demo_report_status: "pending" } : {}),
    },
  })
  if (assistantError) {
    if (close) await supabase.from("sessions").update({ status: "active" }).eq("id", session.id)
    await supabase.from("messages").delete().eq("id", savedUser.id)
    return json({ error: "Reply could not be saved" }, input.requestId, 503)
  }
  if (close && input.runCompletion !== false) {
    await queueSessionCompletion({
      organisationId,
      projectId,
      sessionId: session.id,
      likelyBot: input.likelyBot ?? false,
      requestId: input.requestId,
    })
  }
  return json({
    message: reply,
    status: close ? "completed" : "active",
    reviewStatus: close ? "pending" : "not_ready",
    // The API contract requires per-turn scores. This engine does not score turns, so this is a
    // neutral placeholder; suitability is derived from the reviewer report after completion.
    scores: UNSCORED_TURN,
    ui,
  }, input.requestId)
}
