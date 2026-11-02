import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import type { ApplicantIdentity } from "@/lib/applicant-identity"
import type { ApplicationRichInteraction } from "@/lib/application-rich-interaction"
import {
  DEFAULT_INTERACTION_SPEC,
  normaliseMediaChoiceInteraction,
  type MediaChoiceAnswer,
} from "@/lib/gatekeeper-interaction-spec"
import { supportsForcedToolChoice } from "@/lib/gatekeeper-models"
import { queueSessionCompletion } from "@/lib/session-completion-jobs"
import { logLlmUsage } from "@/lib/llm-usage"
import { log } from "@/lib/logger"
import type { ProjectContext } from "@/lib/project-resolution"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import { DEFAULT_APPLICATION_CLOSING_MESSAGE } from "@/lib/project-settings"

import { applicantAsksQuestion } from "@/lib/colors-engine"
export { applicantAsksQuestion }

type ConversationReply = {
  reply: string
  close: boolean
  boundary: "none" | "consent" | "safety"
  boundaryQuestion: string
  interactionProposal?: unknown
  addsNewContext?: boolean
  choiceKey?: string
  facts?: unknown
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
export const DEFAULT_PRIVACY_QUESTION = "Would you ask for their permission before sharing something private?"
export const DEFAULT_PRIVACY_STATEMENT = "Sharing someone else's private information requires their permission."

export function isConsentQuestion(question: string): boolean {
  return question.trim().endsWith("?") && /\b(?:consent|permission|ask|agree|approval)\b/i.test(question)
}

/** From this many applicant answers, Groucho is told to wrap up unless something genuinely new is open. */
export const WRAP_UP_ANSWERS = 5
/** At this many applicant answers the runtime closes, unless the applicant has just asked a question or a boundary is open. */
export const SOFT_CLOSE_ANSWERS = 7

export const conversationResponseTool = {
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
export const CONVERSATION_OUTPUT_SCHEMA = strictJsonSchema(conversationResponseTool.input_schema) as Record<string, unknown>


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

export type ConversationFact = { key: string; value: string; sourceQuote: string }
export type ConversationField = { key: string; label: string; required?: boolean; values?: readonly string[] }
export type ConversationChoice = { question: string; options: readonly string[]; field?: string }
export type ConversationConfiguration = {
  id: string
  marker: string
  model: string
  buildPrompt: (input: { applicationAudience: "community" | "artist"; hasApplicantDetails: boolean; turnCount: number; shows: unknown[] }) => string
  loadMedia?: () => Promise<unknown[]>
  resolveInteraction?: (proposal: unknown, items: unknown[]) => ApplicationRichInteraction | null
  operationPrefix?: string
  fields?: readonly ConversationField[]
  choices?: Readonly<Record<string, ConversationChoice>>
  closingMessage?: string
  completionMessage?: string
  wrapUpAnswers?: number
  softCloseAnswers?: number
  consentQuestion?: string
  consentStatement?: string
}

/** Accept only catalogue fields supported by an exact quote from the current answer. */
export function conversationFacts(raw: unknown, answer: string, fields: readonly ConversationField[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(raw)) return out
  for (const candidate of raw.slice(0, 12)) {
    const fact = record(candidate)
    const field = fields.find(item => item.key === fact.key)
    if (!field || typeof fact.value !== "string" || typeof fact.sourceQuote !== "string") continue
    const value = fact.value.trim()
    const quote = fact.sourceQuote.trim()
    if (!value || value.length > 500 || !quote || !answer.toLowerCase().includes(quote.toLowerCase())) continue
    if (field.values && !field.values.includes(value)) continue
    if (field.values) {
      const samePlace = field.values.filter(option => option.split(",")[0] === value.split(",")[0])
      if (samePlace.length > 1 && !samePlace.some(option => quote.toLowerCase().includes(option.toLowerCase()))) continue
    }
    out[field.key] = value
  }
  return out
}

export async function postConversation(input: {
  configuration: ConversationConfiguration

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
  const config = input.configuration
  const operation = (name: string) => `${config.operationPrefix ?? "conversation"}_${name}`
  const fields = config.fields ?? []
  const choices = config.choices ?? {}
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
  if (record(history[0].metadata).conversation_engine !== config.marker) {
    return json({ error: "Session uses a different conversation engine" }, input.requestId, 409)
  }
  if (fields.length && record(history[0].metadata).conversation_profile !== config.id) {
    return json({ error: "Start a new conversation for this demo" }, input.requestId, 409)
  }
  const lastAssistant = [...history].reverse().find((entry) => entry.role === "assistant")
  const previousDetails = record(record(lastAssistant?.metadata).conversation_details)
  const detailsBeforeTurn = Object.fromEntries(fields.flatMap(field =>
    typeof previousDetails[field.key] === "string" ? [[field.key, previousDetails[field.key] as string]] : []))
  const previousChoiceKey = record(lastAssistant?.metadata).conversation_choice_key
  const selectedChoice = typeof previousChoiceKey === "string" && Object.hasOwn(choices, previousChoiceKey) ? choices[previousChoiceKey] : undefined
  if (selectedChoice?.field && selectedChoice.options.includes(input.message.trim()) && fields.some(field => field.key === selectedChoice.field)) {
    detailsBeforeTurn[selectedChoice.field] = input.message.trim()
  }
  const detailsFor = (reply: ConversationReply) => ({ ...detailsBeforeTurn, ...conversationFacts(reply.facts, input.message, fields) })
  const missingFor = (reply: ConversationReply) => fields.filter(field => field.required && !detailsFor(reply)[field.key])
  const choiceFor = (reply: ConversationReply): ConversationChoice | undefined => {
    if (reply.choiceKey && reply.choiceKey !== "none") return Object.hasOwn(choices, reply.choiceKey) ? choices[reply.choiceKey] : undefined
    return Object.values(choices).find(choice => reply.reply.toLowerCase().includes(choice.question.toLowerCase()))
  }
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
  let shows: unknown[] = []
  if (config.loadMedia && !hasShownMedia && turnCount > 1) {
    try {
      shows = await config.loadMedia()
    } catch (error) {
      log.warn(operation("media_unavailable"), {
        requestId: input.requestId,
        sessionId: input.sessionId,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const currentAnswer = input.interactionAnswer
    ? `${input.message}\nMedia choice: ${JSON.stringify(input.interactionAnswer)}`
    : input.message
  const stoppedByApplicant = fields.length > 0 && /^(?:(?:no thanks[,!.]?\s*)?(?:please\s+)?stop(?:\s+(?:now|this|the conversation))?[.!?]*|(?:can|could) (?:we|you) (?:please )?stop(?: (?:now|this|the conversation))?[.!?]*|(?:let'?s|i want to|i'd like to) (?:stop|end (?:this|the conversation))[.!?]*|(?:no thanks|not interested|goodbye|i'm done|i am done)[.!?]*)$/i.test(input.message.trim())
  const applicantQuestion = !stoppedByApplicant && applicantAsksQuestion(input.message)
  const conversation = history.filter((entry) => entry.role === "assistant" || entry.role === "user")
    .slice(-20).map((entry) => ({
      role: entry.role as "assistant" | "user",
      content: entry.content as string,
    }))
  const model = input.modelOverride?.trim() || config.model
  const previousProgress = [...history].reverse().filter(entry => entry.role === "assistant")
  let quietTurns = 0
  for (const entry of previousProgress) {
    if (record(record(entry.metadata).conversation_progress).adds_new_context !== false) break
    quietTurns += 1
  }
  const system = config.buildPrompt({
    applicationAudience: session.application_audience === "artist" ? "artist" : "community",
    hasApplicantDetails: Boolean(session.applicant_details),
    turnCount,
    shows,
  }) + `\n\nPrevious consecutive answers without new context: ${quietTurns}. A genuine applicant question always deserves an answer. Do not re-probe something they have already said they cannot explain.` +
    (fields.length ? `\nConfirmed conversation details: ${JSON.stringify(detailsBeforeTurn)}. Preserve these facts; do not ask for them again.\nCapture new details only with a sourceQuote copied exactly from the CURRENT applicant answer. Approved fields: ${JSON.stringify(fields)}. Use the exact approved value for enumerated fields.\nApproved choices: ${JSON.stringify(choices)}. When asking a registered choice question, set choiceKey to its key. Never invent options or ask a choice question without a choiceKey. Otherwise use none. Do not close before the required details are known unless the applicant wants to stop, a boundary ends the exchange, or the runtime instructs a close. No reservations, approvals or codes are issued by this simulation.` : "")
  const responseTool = fields.length ? {
    ...conversationResponseTool,
    input_schema: {
      ...conversationResponseTool.input_schema,
      properties: {
        ...conversationResponseTool.input_schema.properties,
        choiceKey: { type: "string", enum: ["none", ...Object.keys(choices)] },
        facts: { type: "array", items: {
          type: "object",
          properties: {
            key: { type: "string", enum: fields.map(field => field.key) },
            value: { type: "string" },
            sourceQuote: { type: "string" },
          },
          required: ["key", "value", "sourceQuote"],
        } },
      },
      required: [...conversationResponseTool.input_schema.required, "choiceKey", "facts"],
    },
  } : conversationResponseTool

  async function requestReply(operation: string, instruction: string, maxTokens = fields.length ? 1000 : 600,
    onReply?: (text: string) => void): Promise<ConversationReply> {
    const forcedTool = supportsForcedToolChoice(model)
    const base = {
      model, max_tokens: maxTokens,
      system: system + "\n\n" + instruction + (forcedTool ? "" : "\n\nReturn the groucho_converse fields as one JSON object."),
      messages: [...conversation, { role: "user" as const, content: currentAnswer }],
    }
    const request = forcedTool
      ? { ...base, tools: [responseTool], tool_choice: { type: "tool" as const, name: responseTool.name } }
      : { ...base, output_config: { format: { type: "json_schema" as const, schema: strictJsonSchema(responseTool.input_schema) } } }
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
      const call = response.content.find(block => block.type === "tool_use" && block.name === conversationResponseTool.name)
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
      choiceKey: typeof value.choiceKey === "string" ? value.choiceKey : undefined,
      facts: value.facts,
      ...(typeof value.addsNewContext === "boolean" ? { addsNewContext: value.addsNewContext } : {}) }
  }
  function hasQuestion(reply: ConversationReply): boolean {
    const rich = reply.boundary === "none" ? config.resolveInteraction?.(reply.interactionProposal, shows) ?? null : null
    if (fields.length && reply.boundary === "none") {
      const choice = choiceFor(reply)
      if (choice?.field && detailsFor(reply)[choice.field]) return false
      if (reply.choiceKey && reply.choiceKey !== "none" && !choiceFor(reply)) return false
      if (/\b(?:which (?:sounds|of these|of those)|choose|pick|select|which one|which night)\b/i.test(reply.reply) && !choiceFor(reply)) return false
      if (choiceFor(reply)) return true
    }
    return reply.boundary === "consent" && reply.boundaryQuestion.endsWith("?") ||
      oneQuestion(rich?.question ?? reply.reply).includes("?")
  }
  const questionInstruction = "The applicant asked a direct question. Answer it using only the approved project context, saying what is unknown when needed. Do not restate their question. Set close=false and finish with one relevant open question."
  let proposal: ConversationReply
  let addsNewContext: boolean | undefined
  let stopReason: "no_new_context" | "soft_limit" | "emergency_limit" | undefined
  try {
    const forcedClosePossible = !applicantQuestion &&
      (turnCount >= (config.softCloseAnswers ?? SOFT_CLOSE_ANSWERS) || turnCount >= emergencyLimit || (turnCount >= 3 && quietTurns >= 1))
    const streamReply = forcedClosePossible ? undefined : input.onReplyDelta
    proposal = await requestReply(operation("conversation"), applicantQuestion ? questionInstruction :
      stoppedByApplicant ? "The applicant wants to stop. Acknowledge that briefly and close without a question or decision." :
      turnCount >= emergencyLimit ? "The emergency conversation limit is reached. Acknowledge the latest point and close neutrally without a question or decision." :
        turnCount >= (config.wrapUpAnswers ?? WRAP_UP_ANSWERS) ? "The conversation is ready to wrap up. Close now unless the latest answer opened something genuinely new that you do not yet understand. Never continue only to deepen a thread." :
          "Continue only if a useful thread remains; otherwise close naturally.", undefined, streamReply)
    addsNewContext = applicantQuestion ? true : proposal.addsNewContext
    const stalled = turnCount >= 3 && addsNewContext === false && quietTurns >= 1
    const softLimitReached = turnCount >= (config.softCloseAnswers ?? SOFT_CLOSE_ANSWERS)
    if (!applicantQuestion && proposal.boundary === "none" && (stalled || softLimitReached || turnCount >= emergencyLimit)) {
      stopReason = turnCount >= emergencyLimit ? "emergency_limit" : stalled ? "no_new_context" : "soft_limit"
      // Formatting repairs must not turn a settled exchange into another interview.
      proposal = { ...proposal, close: true, interactionProposal: undefined }
    }
    if (stoppedByApplicant) proposal = { ...proposal, close: true, boundary: "none", boundaryQuestion: "", interactionProposal: undefined }
    const closesBeforeReady = (reply: ConversationReply) => fields.length > 0 && reply.close && reply.boundary === "none" &&
      missingFor(reply).length > 0 && !stoppedByApplicant && !stopReason
    const needsRepair = closesBeforeReady(proposal) || !stopReason && (applicantQuestion && (proposal.close || !hasQuestion(proposal)) ||
      !applicantQuestion && !proposal.close && proposal.boundary === "none" && !hasQuestion(proposal))
    if (needsRepair) {
      let usable = false
      let feedback = ""
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const repaired = await requestReply(applicantQuestion ? operation("question_reply_repair") : operation("active_question_repair"),
            (applicantQuestion ? questionInstruction : fields.length
              ? `Return an answerable turn with one clear question or approved choiceKey. Required details still missing: ${missingFor(proposal).map(field => field.label).join(", ")}. Capture supported facts from the current answer. Continue until these details are understood; never request something already confirmed. A selection question requires its registered choiceKey. Do not select a choiceKey for a field already supplied, including the option the applicant just selected. Use choiceKey=none for an open question.`
              : "The previous active reply had no question. Ask one useful open question if a real thread remains, or set close=true if the exchange is settled. Do not continue for formatting alone.") + feedback)
          if (closesBeforeReady(repaired) || (applicantQuestion ? repaired.close || !hasQuestion(repaired) : !repaired.close && !hasQuestion(repaired))) {
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
    log.error(operation("conversation_failed"), { requestId: input.requestId, sessionId: input.sessionId, detail: error instanceof Error ? error.message : String(error) })
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
    log.warn(operation("boundary_question_replaced"), {
      requestId: input.requestId, sessionId: input.sessionId,
    })
    boundaryQuestion = config.consentQuestion ?? DEFAULT_PRIVACY_QUESTION
  }
  const rich = !requestedClose && proposal.boundary === "none"
    ? config.resolveInteraction?.(proposal.interactionProposal, shows) ?? null
    : null
  const close = requestedClose
  const activeChoice = !close && proposal.boundary === "none" ? choiceFor(proposal) : undefined
  if (!close && !firstBoundaryTurn && !activeChoice && !oneQuestion(rich?.question ?? proposal.reply).includes("?")) {
    log.error(operation("active_reply_question_missing"), {
      requestId: input.requestId, sessionId: input.sessionId, turnCount,
    })
    return json({ error: "Groucho could not respond. Please try again." }, input.requestId, 503)
  }
  const activeRich = close ? null : rich
  const ui = activeChoice
    ? { ...DEFAULT_INTERACTION_SPEC, inputType: "singleSelect" as const, options: [...activeChoice.options] }
    : activeRich?.kind === "reference"
    ? { ...DEFAULT_INTERACTION_SPEC, inputType: "text" as const, referenceCards: activeRich.cards }
    : activeRich?.kind === "choice"
      ? { ...DEFAULT_INTERACTION_SPEC, inputType: "mediaChoice" as const, mediaChoice: activeRich.interaction }
      : DEFAULT_INTERACTION_SPEC
  const boundaryStatement = proposal.reply.split(/\n\s*\n/)[0]
    .replace(/\s*[^.!?]*\?[\s\S]*$/, "").trim()
  const reply = close
    ? conversationalClosing(
      proposal.reply,
      config.closingMessage ?? (settings.applicationExperience.closing_message?.trim() || DEFAULT_APPLICATION_CLOSING_MESSAGE),
    )
    : firstBoundaryTurn
      ? `${boundaryStatement || config.consentStatement || DEFAULT_PRIVACY_STATEMENT} ${boundaryQuestion}`.trim()
      : oneQuestion(activeChoice?.question ?? activeRich?.question ?? proposal.reply)
  const details = detailsFor(proposal)
  const completion = close && config.completionMessage
    ? { mode: "simulation", complete: missingFor(proposal).length === 0, message: config.completionMessage }
    : undefined

  const { data: savedUser, error: userError } = await supabase.from("messages").insert({
    session_id: session.id,
    organisation_id: organisationId,
    project_id: projectId,
    role: "user",
    content: input.message,
    metadata: {
      conversation_engine: config.marker,
      conversation_profile: config.id,
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
      log.error(operation("close_failed"), {
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
      conversation_engine: config.marker,
      conversation_profile: config.id,
      ...(fields.length ? { conversation_details: details } : {}),
      ...(activeChoice ? { conversation_choice_key: Object.keys(choices).find(key => choices[key] === activeChoice) } : {}),
      ...(completion ? { conversation_completion: completion } : {}),
      ui,
      boundary: proposal.boundary,
      conversation_progress: { ...(addsNewContext === undefined ? {} : { adds_new_context: addsNewContext }), ...(stopReason ? { stop_reason: stopReason } : {}) },
      conversation_model: model,
      ...(rich ? { application_rich_interaction: {
        kind: rich.kind,
        purpose: rich.purpose,
      } } : {}),
      ...(close ? { application_closing: true } : {}),
      ...(close && !config.completionMessage ? { colors_demo_report_status: "pending" } : {}),
    },
  })
  if (assistantError) {
    if (close) await supabase.from("sessions").update({ status: "active" }).eq("id", session.id)
    await supabase.from("messages").delete().eq("id", savedUser.id)
    return json({ error: "Reply could not be saved" }, input.requestId, 503)
  }
  if (close && !config.completionMessage && input.runCompletion !== false) {
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
    engine: config.marker,
    profile: config.id,
    status: close ? "completed" : "active",
    reviewStatus: close ? (config.completionMessage ? "not_required" : "pending") : "not_ready",
    // The API contract requires per-turn scores. This engine does not score turns, so this is a
    // neutral placeholder; suitability is derived from the reviewer report after completion.
    scores: UNSCORED_TURN,
    ui,
    ...(fields.length ? { details } : {}),
    ...(completion ? { completion } : {}),
  }, input.requestId)
}
