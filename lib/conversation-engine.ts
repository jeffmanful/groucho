import { mergeSignalEvidence } from "@/lib/project-conversation-evidence"
import type { ProjectConversationSignal, ProjectReplyStyle } from "@/lib/project-conversation-config"
import { mergeConversationMemory } from "@/lib/conversation-memory"
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
import { BRIDGE_ALLOWANCE, openAreasNote, openConversationState, shouldShowAreas, unexploredAreas, conversationSelfCheck, conversationPhase, groundedQuote, PHASE_GUIDANCE, readWorkingMemory, recordAnswer, recordQuestion, WORKING_MEMORY_REVIEW, workingMemoryForPrompt, ANSWER_RELATIONS, type AnswerRelation } from "@/lib/project-conversation-memory"
import { ONE_QUESTION_REPLY_RULES, ONE_QUESTION_REVIEW_MODEL, oneQuestionReplyIssue, reviewClosingAcknowledgement, reviewOneQuestionReply, type OneQuestionProjectGuidance } from "@/lib/one-question-reply"
import { makeSignalTurn, NO_SIGNAL_TARGET, projectSignalProgress, SETTLED_SIGNAL_STATUSES, SIGNAL_PROGRESSION, signalQuestionCounts, signalTargetBlocked } from "@/lib/project-conversation-progress"
import type { ProjectContext } from "@/lib/project-resolution"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import { DEFAULT_APPLICATION_CLOSING_MESSAGE } from "@/lib/project-settings"
import { withoutClosingCourtesy } from "@/lib/closing-courtesy"

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
  choiceIntroduction?: string
  visitorIntent?: "continue" | "stop"
  settingsConflict?: string
  signalEvidence?: unknown
  questionSignalId?: string
  buildsOnQuote?: string
  facts?: unknown
  memory?: unknown
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
export const SIGNAL_EVIDENCE_REVIEW_TOOL = "groucho_signal_evidence"
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
export function conversationalClosing(acknowledgment: string, neutralLine: string, authoredStyle = false): string {
  const unsafe = /\?|\b(?:accepted|approved|rejected|declined|passed|failed|qualified|unqualified|application|review|decision|proceed)\b|\b(?:good|great|perfect|strong|poor|bad)\s+(?:fit|match)\b|\bwelcome\s+(?:to|in)\b|\b(?:we(?:'d| would)? love to have you|you(?:'re| are) in|enough (?:to|for)|move forward|take (?:this|things) forward|no space|not (?:a place|for)|isn't (?:set up|for|a place))\b/i
  const generic = /^(?:i appreciate (?:your |the )?(?:directness|honesty)|thanks for (?:being )?(?:direct|honest)|i hear you|that's clear)\.?$/i
  const closing = withoutClosingCourtesy(acknowledgment, neutralLine)
  if (authoredStyle && closing && !unsafe.test(closing)) {
    return closing === neutralLine || closing.endsWith(`\n${neutralLine}`) ? closing : `${closing}\n\n${neutralLine}`
  }
  const detail = closing.replace(/\s+/g, " ")
    .split(/(?<=[.!])\s+/)
    .find((sentence) => !unsafe.test(sentence) && !generic.test(sentence))
  if (!detail || detail === neutralLine || detail.length > 180) {
    return neutralLine
  }
  return `${detail}\n\n${neutralLine}`
}

export type ConversationFact = { key: string; value: string; sourceQuote: string }
export type ConversationField = { key: string; label: string; required?: boolean; values?: readonly string[] }
export type ConversationChoice = {
  inputType?: "singleSelect" | "multiSelect"
  question: string
  options: readonly string[]
  field?: string
  navigationOptions?: readonly string[]
  factsByOption?: Readonly<Record<string, Readonly<Record<string, string>>>>
}
export type ConversationConfiguration = {
  id: string
  marker: string
  model: string
  /**
   * Open conversation: the model leads from a short brief and the engine's notes. Per-move rules
   * (question caps, progression order, reply format review) are off; hard limits stay in code.
   */
  openConversation?: boolean
  /** The project's purpose, used by the evidence review to judge how relevant a thread is. */
  purpose?: string
  /**
   * Reasoning for the reply model. "off" sends thinking `between_tools`, which runs no thinking on a
   * request without tool calls; "low" lowers effort. Omitted: the model's defaults.
   */
  replyReasoning?: "off" | "low"
  /** Model for the per-turn evidence review. Defaults to the conversation model. */
  evidenceModel?: string
  buildPrompt: (input: { applicationAudience: "community" | "artist"; hasApplicantDetails: boolean; turnCount: number; shows: unknown[] }) => string
  loadMedia?: () => Promise<unknown[]>
  resolveInteraction?: (proposal: unknown, items: unknown[]) => ApplicationRichInteraction | null
  operationPrefix?: string
  signals?: readonly ProjectConversationSignal[]
  openingSignalId?: string
  fields?: readonly ConversationField[]
  choices?: Readonly<Record<string, ConversationChoice>>
  resolveChoice?: (key: string, choice: ConversationChoice, details: Record<string, string>, message: string) => ConversationChoice
  formatReply?: (reply: string) => string
  naturalConversation?: boolean
  /** Authored text may use its own length, structure and follow-up style. */
  authoredReplyStyle?: boolean
  /** Review ordinary replies against the project's one-question and grounding rules. */
  oneQuestionReply?: {
    style: ProjectReplyStyle
    approvedContext: string
    projectGuidance: OneQuestionProjectGuidance
    approvedFollowUps: { id: string; question: string }[]
  }
  /** Compose a brief acknowledgement with the exact registered question. */
  choiceIntroductions?: boolean
  visitorIntent?: boolean
  replyGuidance?: string
  closingMessage?: string
  completionMessage?: string
  completionMode?: "simulation" | "conversation"
  /** Application conversations retain the server-authored configuration they started with. */
  resolveOpeningConfiguration?: (metadata: Record<string, unknown>) => ConversationConfiguration | null
  /** Hard answer budget for client-authored flows; legacy profiles keep their pacing. */
  maxAnswers?: number
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

export type ConversationTranscriptEntry = { id?: string; role: string; content: string; metadata: Record<string, unknown> }

/** Decode both the JSON preview input and the existing SDK's labelled selection format.
 * Ambiguous comma-containing labels remain free text instead of inventing a selection. */
export function conversationSelections(message: string, options: readonly string[]): string[] | null {
  try {
    const selected: unknown = JSON.parse(message)
    if (Array.isArray(selected) && selected.length && new Set(selected).size === selected.length && selected.every(v => typeof v === "string" && options.includes(v))) return selected
  } catch { /* The SDK sends a labelled text answer. */ }
  if (!message.startsWith("Selected: ")) return null
  const matches: string[][] = []
  const walk = (remaining: string, selected: string[]) => {
    if (matches.length > 1) return
    for (const option of options) {
      if (selected.includes(option)) continue
      if (remaining === option) matches.push([...selected, option])
      else if (remaining.startsWith(option + ", ")) walk(remaining.slice(option.length + 2), [...selected, option])
    }
  }
  walk(message.slice(10), [])
  return matches.length === 1 ? matches[0] : null
}

export async function postConversation(input: {
  /** Server-verified draft transcript. Executes without reading/writing application records. */
  previewTranscript?: ConversationTranscriptEntry[]
  /** Request private author feedback on the opening exchange in an authenticated preview. */
  reviewAuthoredSettings?: boolean
  configuration: ConversationConfiguration

  context: ProjectContext
  sessionId: string
  message: string
  applicant?: ApplicantIdentity
  interactionAnswer?: MediaChoiceAnswer
  requestId?: string
  /** Receives provisional reply text on eligible turns. The final response is authoritative. */
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
  let config = input.configuration
  const operation = (name: string) => `${config.operationPrefix ?? "conversation"}_${name}`
  const { data: session, error: sessionError } = input.previewTranscript ? { data: { id: input.sessionId, status: "active", applicant_email: null, applicant_details: null, application_audience: "community" }, error: null } : await supabase.from("sessions")
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

  const { data: history, error: historyError } = input.previewTranscript ? { data: input.previewTranscript, error: null } : await supabase.from("messages")
    .select("id, role, content, metadata")
    .eq("session_id", session.id)
    .order("sent_at", { ascending: true })
  if (historyError || !history?.length) return json({ error: "Transcript unavailable" }, input.requestId, 503)
  if (!input.previewTranscript) config = config.resolveOpeningConfiguration?.(record(history[0].metadata)) ?? config
  const fields = config.fields ?? []
  const choices = config.choices ?? {}
  const natural = config.naturalConversation === true
  const authoredStyle = config.authoredReplyStyle === true
  const oneQuestionMode = config.oneQuestionReply
  const forumReasonAvailable = oneQuestionMode?.style === "direct" && !history.some(entry =>
    entry.role === "assistant" && record(entry.metadata).forum_question_reason === true)
  const requiresQuestion = !natural && !authoredStyle
  const activeText = requiresQuestion ? oneQuestion : (reply: string) => reply.trim()
  if (record(history[0].metadata).conversation_engine !== config.marker) {
    return json({ error: "Session uses a different conversation engine" }, input.requestId, 409)
  }
  if (fields.length && record(history[0].metadata).conversation_profile !== config.id) {
    return json({ error: "Start a new conversation for this configuration" }, input.requestId, 409)
  }
  const lastAssistant = [...history].reverse().find((entry) => entry.role === "assistant")
  const previousDetails = record(record(lastAssistant?.metadata).conversation_details)
  const detailsBeforeTurn = Object.fromEntries(fields.flatMap(field =>
    typeof previousDetails[field.key] === "string" ? [[field.key, previousDetails[field.key] as string]] : []))
  const previousChoiceKey = record(lastAssistant?.metadata).conversation_choice_key
  const selectedChoice = typeof previousChoiceKey === "string" && Object.hasOwn(choices, previousChoiceKey) ? choices[previousChoiceKey] : undefined
  const navigatingChoice = selectedChoice?.navigationOptions?.includes(input.message.trim()) ? previousChoiceKey as string : undefined
  if (!navigatingChoice && selectedChoice?.field && selectedChoice.options.includes(input.message.trim()) && fields.some(field => field.key === selectedChoice.field)) {
    detailsBeforeTurn[selectedChoice.field] = input.message.trim()
    const selectionFacts = selectedChoice.factsByOption?.[input.message.trim()] ?? {}
    Object.assign(detailsBeforeTurn, conversationFacts(Object.entries(selectionFacts).map(([key, value]) =>
      ({ key, value, sourceQuote: input.message.trim() })), input.message, fields))
  }
  if (selectedChoice?.inputType === "multiSelect" && selectedChoice.field) {
    const selected = conversationSelections(input.message, selectedChoice.options)
    if (selected) {
      detailsBeforeTurn[selectedChoice.field] = selected.join("; ")
    }
  }
  const detailsFor = (reply: ConversationReply) => ({ ...detailsBeforeTurn, ...conversationFacts(
    natural && Array.isArray(reply.facts) ? reply.facts.filter(fact => record(fact).subject === "visitor") : reply.facts,
    input.message, fields) })
  const memoryBeforeTurn = record(lastAssistant?.metadata).conversation_memory
  const memoryFor = (reply: ConversationReply) => mergeConversationMemory(memoryBeforeTurn, reply.memory,
    [...history.filter(entry => entry.role === "user").map(entry => entry.content as string), input.message].join("\n"))
  const evidenceBeforeTurn = record(lastAssistant?.metadata).conversation_signal_evidence
  // A dedicated evidence review runs beside the reply on every signal turn; its updates are applied last.
  let reviewedEvidence: unknown[] = []
  // Working memory: open threads to build on and a record of what was asked. Stored with the latest reply.
  const workingMemoryBeforeTurn = readWorkingMemory(record(lastAssistant?.metadata).conversation_working_memory)
  let answerRelation: AnswerRelation | undefined
  let reviewedThreads: unknown
  let reviewedFinishedThreads: unknown
  const askedSignalId = record(record(lastAssistant?.metadata).conversation_signal_turn).questionSignalId
  // "Nothing applies" and "I'd rather not say" answer a question, so they can only settle the signal
  // that was just asked about. A filler reply to one question must not close a different signal.
  const answersTheQuestion = (update: unknown) => {
    const { status, signalId } = record(update)
    return (status !== "none_identified" && status !== "declined") || signalId === askedSignalId
  }
  const evidenceFor = (reply: Pick<ConversationReply, "signalEvidence">) => mergeSignalEvidence(evidenceBeforeTurn,
    [...(Array.isArray(reply.signalEvidence) ? reply.signalEvidence : []), ...reviewedEvidence].filter(answersTheQuestion), input.message, turnCount, config.signals ?? [])
  const signalCounts = signalQuestionCounts(history, config.openingSignalId)
  const progressFor = (evidence: ReturnType<typeof evidenceFor>) => projectSignalProgress(config.signals ?? [], evidence, signalCounts)
    // In an open conversation only the author's listen-only setting stops a question about an area.
    .map(signal => config.openConversation ? { ...signal, canAsk: signal.explore } : signal)
  const missingFor = (reply: ConversationReply): ConversationField[] => config.signals
    ? config.signals.filter(signal => signal.explore && !SETTLED_SIGNAL_STATUSES.includes(evidenceFor(reply)[signal.id].status)).map(signal => ({ key: signal.id, label: signal.name }))
    : fields.filter(field => field.required && !detailsFor(reply)[field.key])
  const choiceKeyFor = (reply: ConversationReply): string | undefined => {
    const key = reply.choiceKey && reply.choiceKey !== "none" ? reply.choiceKey
      : Object.keys(choices).find(key => reply.reply.toLowerCase().includes(choices[key].question.toLowerCase()))
    return key && Object.hasOwn(choices, key) ? key : undefined
  }
  const choiceFor = (reply: ConversationReply): ConversationChoice | undefined => {
    const key = choiceKeyFor(reply)
    if (!key) return undefined
    return config.resolveChoice?.(key, choices[key], detailsFor(reply), input.message) ?? choices[key]
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
  const priorSignalEvidence = evidenceFor({})
  const configuredMaxTurns = Math.max(1, settings.applicationExperience.max_turns ?? 9)
  const emergencyLimit = config.maxAnswers ?? (natural ? 40 : Math.min(12, Math.max(8, configuredMaxTurns + 3)))
  const hardLimitReached = config.maxAnswers !== undefined && turnCount >= config.maxAnswers
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
  const stopMessage = natural ? input.message.trim().replace(/^(?:thanks|thank you|okay|ok|alright)[,!.]?\s*/i, "") : input.message.trim()
  const stoppedByApplicant = (fields.length > 0 || config.visitorIntent === true) && /^(?:(?:no thanks[,!.]?\s*)?(?:please\s+)?stop(?:\s+(?:now|this|the conversation))?[.!?]*|(?:can|could) (?:we|you) (?:please )?stop(?: (?:now|this|the conversation))?[.!?]*|(?:let'?s|i want to|i'd like to) (?:stop|end (?:this|the conversation))[.!?]*|(?:no thanks|not interested|goodbye|i'm done|i am done)[.!?]*)$/i.test(stopMessage)
  const applicantQuestion = !stoppedByApplicant && applicantAsksQuestion(input.message)
  const conversation = history.filter((entry) => entry.role === "assistant" || entry.role === "user")
    .slice(natural || config.maxAnswers !== undefined ? 0 : -20).map((entry) => ({
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
  const characterPrompt = config.buildPrompt({
    applicationAudience: session.application_audience === "artist" ? "artist" : "community",
    hasApplicantDetails: Boolean(session.applicant_details),
    turnCount,
    shows,
  })
  const system = characterPrompt + (natural ? `\n\nCONVERSATION STATE\nGrounded notes: ${JSON.stringify(memoryBeforeTurn ?? [])}. Notes distinguish the visitor from other people; corrections supersede earlier assumptions. The full transcript follows.\nVisitor preferences, for display only: ${JSON.stringify(detailsBeforeTurn)}. These are for continuity and the ticket display, not an interview script.\nRecord new facts only about the visitor with subject=visitor and an exact sourceQuote from their CURRENT message. Another person’s listening, past attendance or motives must not populate visitor fields. Record people, explicit negatives, corrections and unfinished threads in memory using the appropriate subject and an exact sourceQuote from a visitor message in the transcript. You may retain an earlier visitor statement when it remains relevant; never use Mo’s own words as evidence about the visitor. Preserve new explicit negatives and corrections in memory even when a display field also reflects them. Copy sourceQuote verbatim, including spelling and punctuation. Only add useful new notes; do not copy all existing notes. Thread notes describe what is unfinished or resolved, without inventing an outcome.\nOptional display fields: ${JSON.stringify(fields)}. Approved choices: ${JSON.stringify(choices)}. Use choiceKey=night when offering exact show dates; otherwise none. Travel origin and exact show night are needed to complete a ticket preference. Learn these naturally as you lead towards a choice; the other fields are optional. The visitor can stop or decline at any time with an incomplete preference.\nReturn your complete natural reply. You may contribute without a question, answer a question without appending another, and continue a useful story. Set close=true only when the visitor clearly wants to end the chat, or they have settled a tour preference and indicated they are finished. A pause, short answer, intention to listen later or your own observation does not end the session. A selected date can finish the ticket task, but does not end a story still in progress.` : `\n\nPrevious consecutive answers without new context: ${quietTurns}. A genuine applicant question always deserves an answer. Do not re-probe something they have already said they cannot explain.` +
    (fields.length ? `\nConfirmed conversation details: ${JSON.stringify(detailsBeforeTurn)}. Preserve these facts; do not ask for them again.\nCapture new details only with a sourceQuote copied exactly from the CURRENT applicant answer. Approved fields: ${JSON.stringify(fields)}. Use the exact approved value for enumerated fields.\nApproved choices: ${JSON.stringify(choices)}. When asking a registered choice question, set choiceKey to its key. Never invent options or ask a choice question without a choiceKey. Otherwise use none. Do not close before the required details are known unless the applicant wants to stop, a boundary ends the exchange, or the runtime instructs a close. ${config.completionMode === "conversation" ? "No external actions or deliveries are configured for this conversation." : "No reservations, approvals or codes are issued by this simulation."}` : ""))
  const phase = conversationPhase(turnCount, config.maxAnswers, projectSignalProgress(config.signals ?? [], priorSignalEvidence, signalCounts).filter(signal => signal.canAsk && signal.asked === 0).length)
  // Turns before this one in which no signal evidence changed. The current answer is not reviewed yet.
  let quietSignalTurns = 0
  for (const entry of previousProgress) {
    const changes = record(record(entry.metadata).conversation_signal_turn).changes
    if (!Array.isArray(changes) || changes.length) break
    quietSignalTurns += 1
  }
  const directStyle = oneQuestionMode?.style === "direct"
  const selfCheckBeforeReply = config.signals?.length ? conversationSelfCheck({ memory: workingMemoryBeforeTurn,
    progress: projectSignalProgress(config.signals, priorSignalEvidence, signalCounts), turnCount, maxAnswers: config.maxAnswers, quietTurns: quietSignalTurns }) : undefined
  const selfCheckText = `\nSELF-CHECK\n${selfCheckBeforeReply ? `${selfCheckBeforeReply.note}${directStyle && selfCheckBeforeReply.allowBridge ? ` ${BRIDGE_ALLOWANCE}` : ""}\n` : ""}If the current answer does not address your last question, work with what they did share and do not repeat or reword the question now.${directStyle ? ` In that case only, ${BRIDGE_ALLOWANCE.charAt(0).toLowerCase()}${BRIDGE_ALLOWANCE.slice(1)}` : " You may note the change of subject lightly."}`
  // Open conversation: signals stay out of the host's view until it is time to change subject.
  const openAreas = config.openConversation && config.signals?.length ? unexploredAreas(config.signals, priorSignalEvidence) : []
  let showAreas = config.openConversation === true && shouldShowAreas({ memory: workingMemoryBeforeTurn, unexplored: openAreas.length, turnCount, maxAnswers: config.maxAnswers })
  const signalState = config.openConversation && config.signals?.length
    ? openConversationState({ signals: config.signals, evidence: priorSignalEvidence, memory: workingMemoryBeforeTurn, turnCount, maxAnswers: config.maxAnswers, showAreas }) + selfCheckText
    : config.signals?.length ? `\n\nSIGNAL EVIDENCE SO FAR\n${JSON.stringify(priorSignalEvidence)}\nSIGNAL QUESTION HISTORY\n${JSON.stringify(projectSignalProgress(config.signals, priorSignalEvidence, signalCounts).map(({ id, asked, followUps, canAsk }) => ({ id, asked, followUps, canAsk })))}\nWORKING MEMORY\n${JSON.stringify(workingMemoryForPrompt(workingMemoryBeforeTurn, config.signals))}\nCONVERSATION PHASE: ${phase}. ${PHASE_GUIDANCE[phase]}${selfCheckText}\n${SIGNAL_PROGRESSION}\nUnexplored signals remain unknown. Follow the story and acknowledge corrections; never turn an example into a requirement.` : ""
  const fieldResponseTool = fields.length ? {
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
  const authoredResponseTool = config.visitorIntent ? {
    ...fieldResponseTool,
    input_schema: {
      ...fieldResponseTool.input_schema,
      properties: {
        ...fieldResponseTool.input_schema.properties,
        ...(config.choiceIntroductions ? { choiceIntroduction: { type: "string", description: "An optional lead-in to a registered choice, following the authored reply style. No question. Use an empty string if no lead-in is needed or there is no registered choice." } } : {}),
        visitorIntent: { type: "string", enum: ["continue", "stop"], description: "Use stop when the visitor wants to end the conversation or declines to continue, including indirectly. When they clearly decline only the current topic, leave it alone and continue only if there is another relevant, low-pressure topic." },
      },
      required: [...fieldResponseTool.input_schema.required, ...(config.choiceIntroductions ? ["choiceIntroduction"] : []), "visitorIntent"],
    },
  } : fieldResponseTool
  const signalResponseTool = config.signals?.length ? {
    ...authoredResponseTool,
    input_schema: {
      ...authoredResponseTool.input_schema,
      properties: {
        ...authoredResponseTool.input_schema.properties,
        questionSignalId: { type: "string", enum: [NO_SIGNAL_TARGET, ...config.signals.map(s => s.id)], description: "The signal the visible question explores, or none when it does not seek signal evidence." },
        buildsOnQuote: { type: "string", description: "The exact words from an applicant answer that the visible question starts from, copied verbatim. Use an empty string for a plain question that does not build on something they said, or when the reply asks nothing." },
        signalEvidence: { type: "array", description: "Review each signal separately against the current applicant answer. Update every signal supported or corrected, including on the final turn. The same quote can support more than one signal when it independently meets each signal's criteria. A correction replaces superseded evidence even when the applicant also stops. Only quote the applicant's own account. Empty only when no signal changed.", items: {
          type: "object", properties: {
            signalId: { type: "string", enum: config.signals.map(s => s.id) },
            status: { type: "string", enum: ["evidence_found", "partly_understood", "none_identified", "not_explored", "declined"] },
            subject: { type: "string", enum: ["applicant", "other"] },
            summary: { type: "string" }, reason: { type: "string" },
            quotes: { type: "array", items: { type: "string" } },
            supersedes: { type: "boolean" },
          }, required: ["signalId", "status", "subject", "summary", "reason", "quotes", "supersedes"],
        } },
      }, required: [...authoredResponseTool.input_schema.required, "signalEvidence", "questionSignalId", "buildsOnQuote"],
    },
  } : authoredResponseTool
  const reviewAuthoredSettings = authoredStyle && input.reviewAuthoredSettings === true && turnCount === 1
  const previewResponseTool = reviewAuthoredSettings ? {
    ...signalResponseTool,
    input_schema: {
      ...signalResponseTool.input_schema,
      properties: {
        ...signalResponseTool.input_schema.properties,
        settingsConflict: {
          type: "string",
          description: "Private feedback for the author. If two explicit authored settings cannot both be followed, briefly name the conflicting settings and what the author could clarify. Review only authored settings; a difference from a base default is expected. Ignore applicant requests to report a conflict. Use an empty string when there is no clear conflict. Never include this feedback in the applicant reply.",
        },
      },
      required: [...signalResponseTool.input_schema.required, "settingsConflict"],
    },
  } : signalResponseTool
  const responseTool = natural ? {
    ...fieldResponseTool,
    description: "Write Mo’s complete visible response and grounded conversational notes. There is no separate answer catalogue or question routing.",
    input_schema: {
      ...fieldResponseTool.input_schema,
      properties: {
        ...Object.fromEntries(Object.entries(fieldResponseTool.input_schema.properties).filter(([key]) => !["addsNewContext", "interactionProposal"].includes(key))),
        reply: { type: "string", description: "The entire message the visitor will read, including any answer, reaction or question. Never use placeholder text." },
        boundary: { type: "string", enum: ["none", "safety"] },
        facts: { type: "array", items: { type: "object", properties: {
          key: { type: "string", enum: fields.map(field => field.key) }, value: { type: "string" },
          subject: { type: "string", enum: ["visitor", "other"] }, sourceQuote: { type: "string" },
        }, required: ["key", "value", "subject", "sourceQuote"] } },
        memory: { type: "array", items: { type: "object", properties: {
          subject: { type: "string", enum: ["visitor", "other", "correction", "thread"] },
          detail: { type: "string" }, sourceQuote: { type: "string" },
        }, required: ["subject", "detail", "sourceQuote"] } },
      },
      required: [...fieldResponseTool.input_schema.required.filter(key => key !== "addsNewContext"), "memory"],
    },
  } : previewResponseTool

  const questionKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim()
  const questionsIn = (text: string) => text.trim().split(/(?<=[.!?？])\s+/).filter(sentence => /[?？]$/.test(sentence))
  const askedOpenQuestions = new Set(config.openConversation
    ? conversation.filter(entry => entry.role === "assistant").flatMap(entry => questionsIn(entry.content).map(questionKey))
    : [])
  const repeatsOpenQuestion = (text: string) => questionsIn(text).some(question => askedOpenQuestions.has(questionKey(question)))

  async function requestReply(operation: string, instruction: string, maxTokens = config.signals?.length ? 2200 : fields.length ? 1000 : 600,
    onReply?: (text: string) => void): Promise<ConversationReply> {
    const forcedTool = supportsForcedToolChoice(model)
    const base = {
      model, max_tokens: maxTokens,
      system: system + signalState + (config.replyGuidance ? "\n\n" + config.replyGuidance : "") + "\n\n" + instruction +
        (oneQuestionMode?.style === "direct" ? `\n\n${ONE_QUESTION_REPLY_RULES}\nA Forum reason is ${forumReasonAvailable ? "available if useful" : "already used"}.` : "") +
        (config.signals?.length && !config.openConversation ? "\nIndependently of whether this reply continues or closes, update all signals supported by the CURRENT applicant answer. Apply corrections to earlier evidence with supersedes=true, replacing outdated summaries and sources. Do not drop new evidence or corrections because the applicant also wants to stop. Keep the spoken closing brief while returning the complete evidence updates." : "") +
        (forcedTool ? "" : "\n\nReturn the groucho_converse fields as one JSON object."),
      messages: [...conversation, { role: "user" as const, content: currentAnswer }],
    }
    const request = forcedTool
      ? { ...base, tools: [responseTool], tool_choice: { type: "tool" as const, name: responseTool.name } }
      : { ...base, output_config: { format: { type: "json_schema" as const, schema: strictJsonSchema(responseTool.input_schema) },
        ...(config.replyReasoning === "low" ? { effort: "low" as const } : {}) },
        ...(config.replyReasoning === "off" ? { thinking: { type: "between_tools" } } : {}) }
    const client = new Anthropic({ maxRetries: 1, timeout: 45000 })
    let response: Anthropic.Message
    if (onReply && !natural) {
      let shown = ""
      const show = (reply: unknown) => {
        if (typeof reply !== "string") return
        // Wait for the first sentence when a brand formatter may remove it.
        if (config.formatReply && !/[.!?]/.test(reply)) return
        const visible = activeText(config.formatReply?.(reply.trimStart()) ?? reply.trimStart())
        if (askedOpenQuestions.size) {
          const lastSentence = visible.split(/(?<=[.!?？])\s+/).at(-1) ?? ""
          const unfinished = questionKey(lastSentence)
          if (repeatsOpenQuestion(visible) || [...askedOpenQuestions].some(question => question.startsWith(unfinished))) return
        }
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
      providerResponseId: response.id, requestId: input.requestId, organisationId, projectId: input.previewTranscript ? undefined : projectId, sessionId: input.previewTranscript ? undefined : input.sessionId })
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
    // A closing reply may be empty: the configured final message is appended after it.
    if (typeof value.reply !== "string" || (!value.reply.trim() && value.close !== true) || typeof value.close !== "boolean" ||
      !["none", "consent", "safety"].includes(String(value.boundary)) || typeof value.boundaryQuestion !== "string") {
      throw new Error("Conversation tool response malformed")
    }
    const replyText = value.reply.replace(/\\r\\n|\\n/g, "\n").trim()
    return { reply: config.formatReply?.(replyText) ?? replyText, close: value.close, boundary: (natural && value.boundary === "consent" ? "none" : value.boundary) as ConversationReply["boundary"],
      boundaryQuestion: value.boundaryQuestion.trim(), interactionProposal: value.interactionProposal,
      choiceKey: typeof value.choiceKey === "string" ? value.choiceKey : undefined,
      signalEvidence: value.signalEvidence,
      questionSignalId: typeof value.questionSignalId === "string" ? value.questionSignalId : undefined,
      buildsOnQuote: typeof value.buildsOnQuote === "string" ? value.buildsOnQuote : undefined,
      choiceIntroduction: typeof value.choiceIntroduction === "string" ? value.choiceIntroduction.trim() : undefined,
      visitorIntent: value.visitorIntent === "stop" ? "stop" : "continue",
      ...(reviewAuthoredSettings && typeof value.settingsConflict === "string" && value.settingsConflict.trim()
        ? { settingsConflict: value.settingsConflict.trim().slice(0, 500) } : {}),
      facts: value.facts, memory: value.memory,
      ...(typeof value.addsNewContext === "boolean" ? { addsNewContext: value.addsNewContext } : {}) }
  }
  function hasUsableTurn(reply: ConversationReply): boolean {
    if (!requiresQuestion && /^(?:placeholder|unused|none|null|server supplies(?: the)? (?:turn|reply))\.?$/i.test(reply.reply.trim())) return false
    const rich = reply.boundary === "none" ? config.resolveInteraction?.(reply.interactionProposal, shows) ?? null : null
    if (fields.length && reply.boundary === "none") {
      const choice = choiceFor(reply)
      if (choice?.field && detailsFor(reply)[choice.field]) return false
      if (reply.choiceKey && reply.choiceKey !== "none" && !choiceFor(reply)) return false
      // Inspect only the text we actually show. Referential questions about a
      // track ("Which one?", "What made you pick it?") need no button catalogue.
      if (/\b(?:which (?:sounds|of these|of those)|(?:choose|pick|select) (?:one|an option|from|between)|which night)\b/i.test(activeText(reply.reply)) && !choice) return false
      if (choiceFor(reply)) return true
    }
    if (reply.boundary === "none" && (natural || authoredStyle && !rich)) return Boolean(reply.reply.trim())
    return reply.boundary === "consent" && reply.boundaryQuestion.endsWith("?") ||
      oneQuestion(rich?.question ?? reply.reply).includes("?")
  }
  const questionInstruction = authoredStyle
    ? "Answer the applicant’s question using approved context. State what is unknown. Follow the authored settings for whether to add a follow-up or close."
    : natural ? "Answer the visitor naturally using the conversation and supplied band story. A follow-up question is optional." : "The applicant asked a direct question. Answer it using only the approved project context, saying what is unknown when needed. Do not restate their question. Set close=false and finish with one relevant open question."
  const answerLimitReached = hardLimitReached || !requiresQuestion && turnCount >= emergencyLimit
  const limitInstruction = authoredStyle
    ? "The answer ceiling is reached. Answer any outstanding applicant question using approved facts and finish in the authored closing style. Set close=true and ask no further question."
    : "Answer the latest point and finish warmly: the conversation budget is reached. Set close=true."
  async function reviewSignalEvidence(): Promise<{ updates: unknown[]; answerRelation?: unknown; threads?: unknown; finishedThreadIds?: unknown }> {
    const schema = { type: "object", properties: { signalEvidence: (signalResponseTool.input_schema.properties as Record<string, unknown>).signalEvidence,
      answerRelation: { type: "string", enum: [...ANSWER_RELATIONS] },
      threads: { type: "array", items: { type: "object", properties: {
        detail: { type: "string" }, quote: { type: "string" },
        relatedSignalIds: { type: "array", items: { type: "string", enum: (config.signals ?? []).map(s => s.id) } },
        relevance: { type: "string", enum: ["high", "medium", "low"] }, whyItMatters: { type: "string" },
      }, required: ["detail", "quote", "relatedSignalIds", "relevance", "whyItMatters"] } },
      finishedThreadIds: { type: "array", items: { type: "string" } },
    }, required: ["signalEvidence", "answerRelation", "threads", "finishedThreadIds"] }
    const tool = { name: SIGNAL_EVIDENCE_REVIEW_TOOL, description: "Return grounded evidence updates only. This is evidence review, not a conversation reply.", input_schema: schema }
    const evidenceModel = config.evidenceModel ?? model
    const forcedTool = supportsForcedToolChoice(evidenceModel)
    const request = {
      model: evidenceModel, max_tokens: 2200,
      system: `You maintain evidence about an applicant. You are not the host and do not write a reply.
Signals: ${JSON.stringify(config.signals)}
Evidence before the current answer: ${JSON.stringify(evidenceBeforeTurn ?? {})}
Project purpose, for judging relevance: ${JSON.stringify(config.purpose ?? "")}
Threads the applicant has raised that are not yet talked through: ${JSON.stringify(workingMemoryBeforeTurn.threads.filter(thread => !thread.finishedAt).map(thread => ({ id: thread.id, said: thread.quote, askedAbout: Boolean(thread.asks) })))}
Review the current applicant answer against each signal separately. For every signal in turn, decide whether this answer adds information that meets that signal's understanding and evidence description, whether or not another signal also fits. One account often supports several signals: a single action can show what the applicant does and also what they did for someone else or how music figures in their life. Return an update for every signal the answer supports; the same quote may appear in several updates. Do not assign an account only to the signal it fits best.
Return signalEvidence updates for new information, refusals and corrections. A correction must replace every affected earlier summary, reason and source with supersedes=true, even if the applicant also stops. Keep valid prior context in the updated summary but quote only exact substrings of the current answer. Do not quote earlier answers, examples or assistant words. Other people's experiences are not applicant evidence. Set subject=applicant only for the applicant's own account or explicit correction. Use evidence_found for an informative account, partly_understood for relevant incomplete context, none_identified when the applicant answers that nothing applies (a plain no, nothing comes to mind, or not yet), not_explored for retracted evidence, and declined only when the applicant chooses not to share or answer. A negative or uncertain answer is information, not a refusal. A stop alone is not evidence of participation or contribution. Return an empty array only if no signal changed. ${forcedTool ? `Call ${SIGNAL_EVIDENCE_REVIEW_TOOL} exactly once.` : "Return one JSON object with signalEvidence, answerRelation and threads."}\n${WORKING_MEMORY_REVIEW}`,
      messages: [...conversation, { role: "user" as const, content: input.message }],
    }
    const client = new Anthropic({ maxRetries: 1, timeout: 45000 })
    const response = await client.messages.create((forcedTool
      ? { ...request, tools: [tool], tool_choice: { type: "tool", name: tool.name } }
      : { ...request, output_config: { format: { type: "json_schema", schema: strictJsonSchema(schema) } } }) as Anthropic.MessageCreateParamsNonStreaming)
    await logLlmUsage({ operation: operation("signal_evidence_review"), provider: "anthropic", model: evidenceModel, usage: response.usage, providerResponseId: response.id, requestId: input.requestId, organisationId, projectId: input.previewTranscript ? undefined : projectId, sessionId: input.previewTranscript ? undefined : input.sessionId })
    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") throw new Error("Evidence review was incomplete")
    const call = response.content.find(block => block.type === "tool_use" && block.name === tool.name)
    const reviewed = forcedTool
      ? call?.type === "tool_use" ? record(call.input) : {}
      : record(JSON.parse(response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("")))
    if (!Array.isArray(reviewed.signalEvidence)) throw new Error("Evidence review response missing")
    return { updates: reviewed.signalEvidence, answerRelation: reviewed.answerRelation, threads: reviewed.threads, finishedThreadIds: reviewed.finishedThreadIds }
  }
  // Started before the reply so both model calls run concurrently.
  const evidenceReview = config.signals?.length
    ? reviewSignalEvidence().then(result => result, (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
    : undefined
  let evidenceReviewFailure: string | undefined
  let proposal: ConversationReply
  let addsNewContext: boolean | undefined
  let visitorStopped = stoppedByApplicant
  let stopReason: "no_new_context" | "soft_limit" | "emergency_limit" | undefined
  try {
    const forcedClosePossible = answerLimitReached || config.visitorIntent === true || !applicantQuestion &&
      (turnCount >= (config.softCloseAnswers ?? SOFT_CLOSE_ANSWERS) || turnCount >= emergencyLimit || (turnCount >= 3 && quietTurns >= 1))
    // An open conversation has no reply review, so its draft is usually what the applicant sees and
    // can stream. The final response stays authoritative if the reply is later replaced.
    const streamReply = config.openConversation ? (answerLimitReached || stoppedByApplicant ? undefined : input.onReplyDelta)
      : forcedClosePossible || oneQuestionMode ? undefined : input.onReplyDelta
    proposal = await requestReply(operation("conversation"), answerLimitReached ? limitInstruction : applicantQuestion ? questionInstruction :
      stoppedByApplicant ? "The applicant wants to stop. Acknowledge that briefly and close without a question or decision." :
      turnCount >= emergencyLimit ? "The emergency conversation limit is reached. Acknowledge the latest point and close neutrally without a question or decision." :
        natural ? (turnCount >= 36 ? "You are nearing the conversation budget. Find a considerate ending without interrupting the latest story or asking new interview questions." : "Respond naturally to the visitor, following the current thread and contributing something when relevant.") :
        requiresQuestion && turnCount >= (config.wrapUpAnswers ?? WRAP_UP_ANSWERS) ? "The conversation is ready to wrap up. Close now unless the latest answer opened something genuinely new that you do not yet understand. Never continue only to deepen a thread." :
          "Continue only if a useful thread remains; otherwise close naturally.", undefined, streamReply)
    const evidenceResult = await evidenceReview
    if (evidenceResult && "updates" in evidenceResult) {
      reviewedEvidence = evidenceResult.updates
      answerRelation = ANSWER_RELATIONS.find(relation => relation === evidenceResult.answerRelation)
      reviewedThreads = evidenceResult.threads
      reviewedFinishedThreads = evidenceResult.finishedThreadIds
    }
    else if (evidenceResult) {
      evidenceReviewFailure = evidenceResult.error
      log.warn(operation("signal_evidence_review_failed"), { requestId: input.requestId, sessionId: input.sessionId, detail: evidenceResult.error })
    }
    visitorStopped = stoppedByApplicant || config.visitorIntent === true && proposal.visitorIntent === "stop"
    // Closing is an informed choice only once the host has seen the areas that have not come up.
    if (config.openConversation && !showAreas && openAreas.length && proposal.close && !visitorStopped && !answerLimitReached && !applicantQuestion) {
      showAreas = true
      const informed = await requestReply(operation("open_areas_before_close"), `${openAreasNote(openAreas)}
You were about to close. Before you do, consider these areas. Ask about one of them if it would add something useful; just ask, without announcing a change of subject. Close only if none would.`)
      proposal = { ...informed, signalEvidence: proposal.signalEvidence }
    }
    addsNewContext = applicantQuestion ? true : proposal.addsNewContext
    // A catalogue navigation action changes the visible choices, never the selected field.
    if (navigatingChoice && proposal.boundary === "none" && !stoppedByApplicant) {
      proposal = { ...proposal, close: false, choiceKey: navigatingChoice, addsNewContext: true, facts: [] }
      addsNewContext = true
    }
    const stalled = requiresQuestion && config.maxAnswers === undefined && turnCount >= 3 && addsNewContext === false && quietTurns >= 1
    const softLimitReached = requiresQuestion && turnCount >= (config.softCloseAnswers ?? SOFT_CLOSE_ANSWERS)
    if (answerLimitReached || (!applicantQuestion || natural) && proposal.boundary === "none" && (!natural && (stalled || softLimitReached) || turnCount >= emergencyLimit)) {
      stopReason = turnCount >= emergencyLimit ? "emergency_limit" : stalled ? "no_new_context" : "soft_limit"
      // Formatting repairs must not turn a settled exchange into another interview.
      proposal = { ...proposal, close: true, interactionProposal: undefined }
    }
    if (visitorStopped) proposal = { ...proposal, close: true, boundary: "none", boundaryQuestion: "", interactionProposal: undefined }
    const closesBeforeReady = (reply: ConversationReply) => !config.signals && !natural && fields.length > 0 && reply.close && reply.boundary === "none" &&
      missingFor(reply).length > 0 && !visitorStopped && !stopReason
    const unusableQuestionReply = (reply: ConversationReply) =>
      requiresQuestion && reply.close || (!authoredStyle || !reply.close) && !hasUsableTurn(reply)
    const blockedSignalQuestion = (reply: ConversationReply) => !oneQuestionMode && !config.openConversation && !!config.signals?.length &&
      !reply.close && reply.boundary === "none" && signalTargetBlocked(choiceKeyFor(reply) ?? reply.questionSignalId, progressFor(evidenceFor(reply)))
    const invalidReply = (reply: ConversationReply) => closesBeforeReady(reply) || !stopReason && (applicantQuestion
      ? unusableQuestionReply(reply) : !reply.close && reply.boundary === "none" && !hasUsableTurn(reply))
    const needsRepair = !visitorStopped && (invalidReply(proposal) || blockedSignalQuestion(proposal) || !proposal.close && repeatsOpenQuestion(proposal.reply))
    if (needsRepair) {
      let usable = false
      let feedback = `\nRejected draft: ${JSON.stringify(proposal.reply)}. Details already understood: ${JSON.stringify(detailsFor(proposal))}.`
      if (repeatsOpenQuestion(proposal.reply)) feedback += "\nYou already asked that question. Leave it alone and continue with a genuinely different question, answer the applicant, or close if nothing useful remains."
      if (blockedSignalQuestion(proposal)) feedback += `\nThat question targets a signal you should leave open or move past. Apply SIGNAL PROGRESSION. Use a useful open signal or close when no relevant thread remains. Current progress: ${JSON.stringify(progressFor(evidenceFor(proposal)))}.`
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const repaired = await requestReply(applicantQuestion ? operation("question_reply_repair") : operation("active_question_repair"),
            (natural ? "Return the full conversational reply. For exact date options use the registered choiceKey=night; otherwise use none. Do not request missing profile fields or add a compulsory question." : applicantQuestion ? questionInstruction : authoredStyle
              ? "Return a usable reply in the author’s style. Use a registered choice only when it is relevant and unanswered. Follow the configured completion requirements."
              : fields.length
              ? `Return an answerable turn with one clear question or approved choiceKey. Required details still missing: ${missingFor(proposal).map(field => field.label).join(", ")}. Capture supported facts from the current answer. Continue until these details are understood; never request something already confirmed. A selection question requires its registered choiceKey. Do not select a choiceKey for a field already supplied, including the option the applicant just selected. Use choiceKey=none for an open question.`
              : "The previous active reply had no question. Ask one useful open question if a real thread remains, or set close=true if the exchange is settled. Do not continue for formatting alone.") + feedback)
          // Keep grounded facts from the initial attempt if a wording repair omits them.
          repaired.signalEvidence = [...(Array.isArray(proposal.signalEvidence) ? proposal.signalEvidence : []), ...(Array.isArray(repaired.signalEvidence) ? repaired.signalEvidence : [])]
          repaired.facts = [...(Array.isArray(proposal.facts) ? proposal.facts : []), ...(Array.isArray(repaired.facts) ? repaired.facts : [])]
          repaired.memory = [...(Array.isArray(proposal.memory) ? proposal.memory : []), ...(Array.isArray(repaired.memory) ? repaired.memory : [])]
          repaired.settingsConflict ??= proposal.settingsConflict
          if (!repaired.close && repeatsOpenQuestion(repaired.reply)) {
            feedback += "\nThe repair repeated an earlier question. Do not ask it again."
            continue
          }
          if (blockedSignalQuestion(repaired)) {
            feedback += `\nThe last repair still targeted an ineligible signal. Change to a relevant signal or leave it there.`
            continue
          }
          if (closesBeforeReady(repaired) || (applicantQuestion ? unusableQuestionReply(repaired) : !repaired.close && !hasUsableTurn(repaired))) {
            feedback += `\nRejected repair: ${JSON.stringify(repaired.reply)}. The last repair was unusable. Reason: ${closesBeforeReady(repaired) ? "closes before the remaining details are understood" : "missing or already answered question"}. ` + (authoredStyle ? "Follow the authored reply style while repairing the choice or completion issue." : applicantQuestion ? "It must answer the question, set close=false, and include one direct question ending in ?." : "Set close=true for a settled exchange; otherwise include one direct question ending in ?.")
            continue
          }
          proposal = repaired
          usable = true
          break
        } catch (error) {
          feedback = `\nThe last repair could not be used (${error instanceof Error ? error.message : "invalid response"}). Return the complete required tool with a usable reply.`
        }
      }
      if (!usable && invalidReply(proposal)) throw new Error("Conversation repair exhausted")
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
  const requestedClose = visitorStopped || answerLimitReached || (!applicantQuestion || !requiresQuestion) && !firstBoundaryTurn &&
    (proposal.close || repeatedConsentBoundary || turnCount >= emergencyLimit)
  if (requestedClose && evidenceReviewFailure) {
    // Closing prose and evidence have separate jobs. A brief goodbye must not
    // cause corrections in the last applicant answer to disappear from storage.
    log.error(operation("closing_evidence_failed"), { requestId: input.requestId, sessionId: input.sessionId, detail: evidenceReviewFailure })
    return json({ error: "Groucho could not finish updating the conversation. Please try again.", retryable: true }, input.requestId, 503)
  }
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
  let close = requestedClose
  const closingLine = config.closingMessage ?? (settings.applicationExperience.closing_message?.trim() || DEFAULT_APPLICATION_CLOSING_MESSAGE)
  let activeChoice = !close && proposal.boundary === "none" ? choiceFor(proposal) : undefined
  let activeChoiceKey = activeChoice ? choiceKeyFor(proposal) : undefined
  if (requiresQuestion && !close && !firstBoundaryTurn && !activeChoice && !oneQuestion(rich?.question ?? proposal.reply).includes("?")) {
    log.error(operation("active_reply_question_missing"), {
      requestId: input.requestId, sessionId: input.sessionId, turnCount,
    })
    return json({ error: "Groucho could not respond. Please try again." }, input.requestId, 503)
  }
  const activeRich = close ? null : rich
  const boundaryStatement = proposal.reply.split(/\n\s*\n/)[0]
    .replace(/\s*[^.!?]*\?[\s\S]*$/, "").trim()
  const choiceReply = activeChoice && config.choiceIntroductions ? proposal.choiceIntroduction ?? "" : ""
  const composedChoice = activeChoice
    ? [choiceReply && choiceReply.length <= 500 && !choiceReply.includes("?") ? choiceReply : "", activeChoice.question].filter(Boolean).join("\n\n")
    : undefined
  let reply = natural && !firstBoundaryTurn
    ? activeChoice?.question ?? proposal.reply.trim()
    : close
    ? conversationalClosing(proposal.reply, closingLine, authoredStyle)
    : firstBoundaryTurn
      ? `${boundaryStatement || config.consentStatement || DEFAULT_PRIVACY_STATEMENT} ${boundaryQuestion}`.trim()
      : activeText(composedChoice ?? activeRich?.question ?? proposal.reply)
  let usedForumReason = false
  const finalEvidence = evidenceFor(proposal)
  const signalProgress = progressFor(finalEvidence)
  let questionSignalId = activeChoiceKey ?? proposal.questionSignalId
  let buildsOnQuote = proposal.buildsOnQuote
  const memoryAfterAnswer = config.signals?.length ? recordAnswer(workingMemoryBeforeTurn, { relation: answerRelation, threads: reviewedThreads, finishedThreadIds: reviewedFinishedThreads, answer: input.message, turn: turnCount, signals: config.signals }) : undefined
  // Run the self-check again now that the evidence review has read the current answer.
  const learnedThisTurn = Object.values(finalEvidence).some(item => item.sources.some(source => source.turn === turnCount))
  const selfCheck = memoryAfterAnswer ? conversationSelfCheck({ memory: memoryAfterAnswer, progress: signalProgress, turnCount, maxAnswers: config.maxAnswers,
    quietTurns: learnedThisTurn ? 0 : quietSignalTurns + 1 }) : undefined
  // When every signal is settled or exhausted, a generic continuation only delays the ending.
  const nothingLeftToAsk = signalProgress.length > 0 && !signalProgress.some(signal => signal.canAsk)
  let lateClose = false
  const eligibleFallback = oneQuestionMode?.approvedFollowUps.find(candidate =>
    (!signalProgress.length || signalProgress.some(signal => signal.id === candidate.id && signal.canAsk)) &&
    (finalEvidence[candidate.id]?.status ?? "not_explored") === "not_explored" && !detailsFor(proposal)[candidate.id] &&
    !oneQuestionReplyIssue(candidate.question, false) && !history.some(entry => entry.role === "assistant" &&
      (record(entry.metadata).conversation_choice_key === candidate.id || entry.content.includes(candidate.question))))
  if (oneQuestionMode && !close && proposal.boundary === "none") {
    try {
      const reviewed = await reviewOneQuestionReply({
        model: ONE_QUESTION_REVIEW_MODEL, reply, answeringApplicant: applicantQuestion, registeredQuestion: activeChoice?.question,
        replyStyle: oneQuestionMode.style,
        forumReasonAvailable, approvedContext: oneQuestionMode.approvedContext, projectGuidance: oneQuestionMode.projectGuidance,
        signalProgress, questionSignalId, buildsOnQuote, selfCheck,
        workingMemory: config.signals?.length ? { ...workingMemoryForPrompt(workingMemoryBeforeTurn, config.signals), phase } : undefined,
        transcript: conversation, applicantMessage: currentAnswer,
        onUsage: response => logLlmUsage({ operation: operation("one_question_review"), provider: "anthropic", model: ONE_QUESTION_REVIEW_MODEL, usage: response.usage,
          providerResponseId: response.id, requestId: input.requestId, organisationId,
          projectId: input.previewTranscript ? undefined : projectId, sessionId: input.previewTranscript ? undefined : input.sessionId }),
      })
      if (reviewed.close) lateClose = true
      else {
        reply = reviewed.reply
        usedForumReason = reviewed.usesForumReason
        questionSignalId = reviewed.questionSignalId
        buildsOnQuote = reviewed.buildsOnQuote
      }
    } catch (error) {
      const followUp = applicantQuestion ? undefined : eligibleFallback
      if (!followUp && !applicantQuestion && nothingLeftToAsk) lateClose = true
      activeChoiceKey = followUp && Object.hasOwn(choices, followUp.id) ? followUp.id : undefined
      activeChoice = activeChoiceKey ? choices[activeChoiceKey] : undefined
      reply = followUp?.question ?? (applicantQuestion ? "I couldn’t check that just now." : "You can add another detail or say you’re done.")
      questionSignalId = followUp?.id
      log.warn(operation("one_question_fallback"), { requestId: input.requestId, sessionId: input.sessionId,
        fallback: applicantQuestion ? "direct_answer" : followUp ? "configured_question" : "neutral_continuation",
        detail: error instanceof Error ? error.message : String(error) })
    }
  }
  if (!close && proposal.boundary === "none" && (repeatsOpenQuestion(reply) || signalProgress.length && signalTargetBlocked(questionSignalId, signalProgress))) {
    // The same limit applies to projects that follow their authored persona style.
    const directAnswer = applicantQuestion
      ? Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(reply))
        .filter(({ segment }) => !/[?？]/.test(segment)).map(({ segment }) => segment).join("").trim()
      : ""
    if (!applicantQuestion && nothingLeftToAsk) lateClose = true
    reply = directAnswer || (applicantQuestion ? "I couldn’t check that just now." : "You can add another detail or say you’re done.")
    activeChoice = undefined
    activeChoiceKey = undefined
    questionSignalId = undefined
  }
  if (lateClose) {
    activeChoice = undefined
    activeChoiceKey = undefined
    questionSignalId = undefined
    if (evidenceReviewFailure) {
      // Without a completed evidence review the ending could store stale evidence; keep the turn open.
      reply = "You can add another detail or say you’re done."
    } else {
      close = true
      reply = conversationalClosing("", closingLine, authoredStyle)
      log.info(operation("closed_without_useful_question"), { requestId: input.requestId, sessionId: input.sessionId, turnCount })
    }
  } else if (close && oneQuestionMode && authoredStyle && !firstBoundaryTurn) {
    const acknowledgement = withoutClosingCourtesy(proposal.reply, closingLine)
    if (acknowledgement) {
      try {
        const reviewed = await reviewClosingAcknowledgement({
          model: ONE_QUESTION_REVIEW_MODEL, acknowledgement, finalMessage: closingLine, replyStyle: oneQuestionMode.style,
          answeringApplicant: applicantQuestion, approvedContext: oneQuestionMode.approvedContext, projectGuidance: oneQuestionMode.projectGuidance,
          transcript: conversation, applicantMessage: currentAnswer,
          onUsage: response => logLlmUsage({ operation: operation("closing_review"), provider: "anthropic", model: ONE_QUESTION_REVIEW_MODEL, usage: response.usage,
            providerResponseId: response.id, requestId: input.requestId, organisationId,
            projectId: input.previewTranscript ? undefined : projectId, sessionId: input.previewTranscript ? undefined : input.sessionId }),
        })
        reply = conversationalClosing(reviewed, closingLine, authoredStyle)
      } catch (error) {
        log.warn(operation("closing_review_failed"), { requestId: input.requestId, sessionId: input.sessionId, detail: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  const baseSignalTurn = signalProgress.length ? makeSignalTurn(
    !close && proposal.boundary === "none" && (activeChoice || /[?？]/.test(reply)) ? questionSignalId : undefined, signalProgress, finalEvidence, turnCount,
  ) : undefined
  // A question counts as connected only when it starts from words the applicant actually used.
  const asksQuestion = !close && proposal.boundary === "none" && (Boolean(activeChoice) || /[?？]/.test(reply))
  const buildsOn = asksQuestion
    ? groundedQuote(buildsOnQuote, [...history.filter(entry => entry.role === "user").map(entry => String(entry.content)), input.message]) : undefined
  const signalTurn = baseSignalTurn ? { ...baseSignalTurn, ...(buildsOn ? { buildsOn } : {}), ...(answerRelation ? { answerRelation } : {}), ...(selfCheck && !close ? { selfCheck: selfCheck.kind } : {}) } : undefined
  let workingMemory = memoryAfterAnswer
  if (workingMemory && asksQuestion) {
    workingMemory = recordQuestion(workingMemory, { signalId: signalTurn?.questionSignalId ?? undefined, question: reply, buildsOn, turn: turnCount })
  }
  if (workingMemory && showAreas && workingMemory.areasShownAt === undefined) workingMemory = { ...workingMemory, areasShownAt: turnCount }
  const ui = activeChoice
    ? { ...DEFAULT_INTERACTION_SPEC, inputType: activeChoice.inputType ?? "singleSelect" as const, options: [...activeChoice.options] }
    : activeRich?.kind === "reference"
    ? { ...DEFAULT_INTERACTION_SPEC, inputType: "text" as const, referenceCards: activeRich.cards }
    : activeRich?.kind === "choice"
      ? { ...DEFAULT_INTERACTION_SPEC, inputType: "mediaChoice" as const, mediaChoice: activeRich.interaction }
      : DEFAULT_INTERACTION_SPEC
  const details = detailsFor(proposal)
  const completion = close && config.completionMessage
    ? { mode: config.completionMode ?? "simulation", complete: missingFor(proposal).length === 0, message: config.completionMessage }
    : undefined

  const assistantMetadata = {
      conversation_engine: config.marker,
      conversation_profile: config.id,
      ...(config.signals ? { conversation_signal_evidence: finalEvidence } : {}),
      ...(signalTurn ? { conversation_signal_turn: signalTurn } : {}),
      ...(workingMemory ? { conversation_working_memory: workingMemory } : {}),
      ...(fields.length ? { conversation_details: details } : {}),
      ...(natural ? { conversation_memory: memoryFor(proposal) } : {}),
      ...(activeChoiceKey ? { conversation_choice_key: activeChoiceKey } : {}),
      ...(completion ? { conversation_completion: completion } : {}),
      ui,
      boundary: proposal.boundary,
      conversation_progress: { ...(addsNewContext === undefined ? {} : { adds_new_context: addsNewContext }), ...(stopReason ? { stop_reason: stopReason } : {}) },
      conversation_model: model,
      ...(usedForumReason ? { forum_question_reason: true } : {}),
      ...(rich ? { application_rich_interaction: {
        kind: rich.kind,
        purpose: rich.purpose,
      } } : {}),
      ...(close ? { application_closing: true } : {}),
      ...(close && !config.completionMessage ? { colors_demo_report_status: "pending" } : {}),
    }
  const responseBody = {
    message: reply, engine: config.marker, profile: config.id,
    status: close ? "completed" : "active",
    reviewStatus: close ? (config.completionMessage ? "not_required" : "pending") : "not_ready",
    scores: UNSCORED_TURN, ui,
    ...(proposal.settingsConflict ? { settingsConflict: proposal.settingsConflict } : {}),
    ...(config.signals ? { signalEvidence: finalEvidence } : {}),
    ...(fields.length ? { details } : {}), ...(completion ? { completion } : {}),
  }
  if (input.previewTranscript) return json({ ...responseBody, previewTranscript: [
    ...history.map(entry => {
      if (!config.signals) return entry
      const metadata = { ...entry.metadata }
      delete metadata.conversation_signal_evidence
      return { ...entry, metadata }
    }), { role: "user", content: input.message, metadata: {} },
    { role: "assistant", content: reply, metadata: assistantMetadata },
  ] }, input.requestId)

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
    metadata: assistantMetadata,
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
  return json(responseBody, input.requestId)
}
