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
import { gatekeeperConversationModel } from "@/lib/gatekeeper-models"
import { logLlmUsage } from "@/lib/llm-usage"
import { log } from "@/lib/logger"
import type { ProjectContext } from "@/lib/project-resolution"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import { DEFAULT_APPLICATION_CLOSING_MESSAGE } from "@/lib/project-settings"

export const COLORS_THIN_PILOT_MARKER = "colors_thin_pilot_v1"

type ConversationReply = {
  reply: string
  close: boolean
  boundary: "none" | "consent" | "safety"
  boundaryQuestion: string
  interactionProposal?: unknown
}

export const colorsThinResponseTool = {
  name: "groucho_converse",
  description: "Choose the next applicant-facing turn. Do not assess or score the applicant.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
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
    required: ["reply", "close", "boundary", "boundaryQuestion"],
  },
} as const satisfies Anthropic.Tool

export function colorsThinConversationPrompt(input: {
  objective: string
  turnCount: number
  mediaCatalog: ReturnType<typeof colorsInteractionCatalog>
}): string {
  return `${COLORS_FORUM_PERSONA_PROMPT.split("\n\nMake a private advisory judgment for COLORS.")[0]}

Current project objective: ${input.objective}

${COLORS_FORUM_MEMBERSHIP_CONTEXT}

Give this conversation a loose arc: learn why the person wants to join; hear one concrete thread about COLORS, music, a scene, or another community; understand how they show up with others and what they hope to find or do in this Forum; follow the most revealing detail once; then close. These are purposes, not required questions or a fixed order. An answer may cover several purposes. Skip what is already understood. Make room for their actual COLORS relationship, which may include a favourite show or artist, a general impression, or no prior familiarity. Learn whether music is something they make, listen to, discuss, discover or experience with a scene; none is a higher-status answer. Online and offline communities matter equally. When someone mentions a group, event or scene, follow an interesting detail to understand what they themselves do with other people: how they bring people together, join in, respond or keep an exchange going. Do not redirect an offline story into an online-community check. If their role is already clear, move on. How they would like to participate in the Forum at first helps welcome them, not score them. If a real community story includes a different musical perspective, notice what happened without staging a disagreement test. Once a story already shows how they participate, move toward their COLORS connection or Forum hope rather than asking them to recall a song title, event name, lineup, frequency or another example. Do not ask a second example just to fill a category or keep probing the motive for ordinary sharing.

TONES is an optional branch. If it comes up, follow what the person actually knows or experienced. If it has not come up and there is room after understanding a revealing community detail, one light invitation about whether they know TONES may help introduce the Forum's TONES and live-events space. Ask first; only explain if they do not know it. Use only the approved TONES description above, without embellishment. Do not treat recognition or attendance as proof of fit, require a favourite show, or invent event details.

Speak as Groucho, not as a reviewer. Respond to a specific detail, then ask one clear question at most. Every non-closing text turn must end with one direct question ending in ?. If there is no question worth asking and the exchange has naturally reached an end, set close=true. Vary the wording and route with the person. Do not announce stages, score, classify evidence, or mention an application checklist. A request to clarify or change topic deserves a direct response. Sharing public music links and discussing artists are ordinary Forum activity. Never ask for artist permission because someone shares or recommends music, and never introduce a copyright, remixing or reposting test. If the applicant independently proposes exposing someone else's private material, state the privacy boundary plainly; do not generalise that situation into a test for everyone. Set boundary to consent or safety only for a concrete concern raised in the applicant's own words. Otherwise boundaryQuestion must be empty.

This is answer ${input.turnCount}. Having enough material for a useful report means you may close, not that you should. Continue when the person is developing an interesting thread, offering a revealing detail, or raising something worth responding to. Do not prolong a settled exchange with routine clarifications, repeat a covered purpose, or ask questions only to reach a turn count. Close when the exchange has reached a natural stopping point. On close, write a brief acknowledgment of the person's actual point, not their directness or honesty, with no question, verdict, promise, generic farewell, or comment about having enough information or moving forward. The runtime will add the neutral final line. A higher emergency limit stops genuine loops.

Approved media catalog: ${JSON.stringify(input.mediaCatalog)}. Media is optional. Offer it only when it helps this person's current thread or they ask to see a source. Use only listed IDs. Never imply they watched or understood an asset before they say so. A reference uses one or two image/link cards; a choice uses two to four videos with a rationale. The reply must still make sense if media cannot be shown. Omit interactionProposal for an ordinary text turn or an unresolved boundary.

Turn-routing priority: a favourite COLORS SHOW is a recorded performance, not evidence of attending an event. When someone names a show or artist, follow what they heard, felt or remember if that detail is still open; otherwise move to their music, community or Forum thread. Do not suggest live attendance as an alternative or ask whether they attended unless they themselves introduce a live event. Do not seek event names, dates or lineups to validate what they say. This guides the purpose of a question, not its wording.

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

/** A direct applicant question must receive a live reply before the session can close. */
export function applicantAsksQuestion(message: string): boolean {
  return message.includes("?") ||
    /(?:^|[.!]\s+)(?:is|are|can|could|would|will|do|does|did|should|what|how|why|where|when|who)\b/i.test(message.trim())
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
  applicant: ApplicantIdentity
  interactionAnswer?: MediaChoiceAnswer
  requestId?: string
}): Promise<NextResponse> {
  const { organisationId, projectId, settings } = input.context
  const { data: session, error: sessionError } = await supabase.from("sessions")
    .select("id, status, applicant_email")
    .eq("session_id", input.sessionId)
    .eq("organisation_id", organisationId)
    .eq("project_id", projectId)
    .maybeSingle()
  if (sessionError) return json({ error: "Session unavailable" }, input.requestId, 503)
  if (!session) return json({ error: "Session not found" }, input.requestId, 404)
  if (session.status !== "active") return json({ error: "Session concluded" }, input.requestId, 409)
  if (session.applicant_email !== input.applicant.email) {
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
  const model = gatekeeperConversationModel()
  let proposal: ConversationReply
  try {
    const response = await new Anthropic().messages.create({
      model,
      max_tokens: 600,
      system: colorsThinConversationPrompt({
        objective: COLORS_FORUM_MEMBERSHIP_OBJECTIVE,
        turnCount,
        mediaCatalog: colorsInteractionCatalog(shows),
      }) + (applicantQuestion
        ? "\n\nThe applicant's latest message asks you a direct question. Answer it in your own words using only the approved Forum context. If the answer is uncertain, say what is known and what is not. Do not restate their question as a question. Do not close on this turn; end with one relevant question that lets them respond."
        : turnCount >= emergencyLimit
          ? "\n\nThe emergency conversation limit has been reached. Respond to the person's latest point, then close with a brief, specific acknowledgment. Do not ask another question or imply a membership decision."
          : ""),
      messages: [...conversation, { role: "user", content: currentAnswer }],
      tools: [colorsThinResponseTool],
      tool_choice: { type: "tool", name: colorsThinResponseTool.name },
    })
    logLlmUsage({
      operation: "colors_thin_conversation",
      provider: "anthropic",
      model,
      usage: response.usage,
      requestId: input.requestId,
      organisationId,
      projectId,
      sessionId: input.sessionId,
    })
    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
      throw new Error(`Conversation model stopped: ${response.stop_reason}`)
    }
    const call = response.content.find((block) => block.type === "tool_use" && block.name === colorsThinResponseTool.name)
    if (!call || call.type !== "tool_use") throw new Error("Conversation tool response missing")
    const value = record(call.input)
    if (typeof value.reply !== "string" || !value.reply.trim() ||
      typeof value.close !== "boolean" ||
      !["none", "consent", "safety"].includes(String(value.boundary)) ||
      typeof value.boundaryQuestion !== "string") {
      throw new Error("Conversation tool response malformed")
    }
    proposal = {
      reply: value.reply.trim(),
      close: value.close,
      boundary: value.boundary as ConversationReply["boundary"],
      boundaryQuestion: value.boundaryQuestion.trim(),
      interactionProposal: value.interactionProposal,
    }
    const proposedRich = proposal.boundary === "none"
      ? resolveApplicationRichInteraction(proposal.interactionProposal, shows)
      : null
    const hasActiveQuestion = proposal.boundary === "consent" && proposal.boundaryQuestion.endsWith("?") ||
      oneQuestion(proposedRich?.question ?? proposal.reply).includes("?")
    const needsQuestionRepair = applicantQuestion && (proposal.close || !hasActiveQuestion) ||
      !applicantQuestion && !proposal.close && proposal.boundary === "none" &&
      turnCount < emergencyLimit && !hasActiveQuestion
    if (needsQuestionRepair) {
      log.warn("colors_thin_active_reply_repair", {
        requestId: input.requestId, sessionId: input.sessionId, turnCount,
      })
      const repair = await new Anthropic().messages.create({
        model,
        max_tokens: 600,
        system: colorsThinConversationPrompt({
          objective: COLORS_FORUM_MEMBERSHIP_OBJECTIVE,
          turnCount,
          mediaCatalog: colorsInteractionCatalog(shows),
        }) + (applicantQuestion
          ? "\n\nThe applicant asked a direct question. The previous proposal tried to close or did not leave a clear invitation. Answer their question directly using only the approved Forum context, then ask one relevant question. Do not restate their question as a question. Set close=false. If the answer is uncertain, say what is known and what is not. Do not end the conversation on this turn."
          : "\n\nThe previous proposal left an active conversation without a question. Respond to the person's latest point, then ask one relevant, natural question that lets them continue. Set close=false. Do not end the conversation on this turn."),
        messages: [...conversation, { role: "user", content: currentAnswer }],
        tools: [colorsThinResponseTool],
        tool_choice: { type: "tool", name: colorsThinResponseTool.name },
      })
      logLlmUsage({
        operation: applicantQuestion
          ? "colors_thin_question_reply_repair"
          : "colors_thin_active_question_repair",
        provider: "anthropic",
        model,
        usage: repair.usage,
        requestId: input.requestId,
        organisationId,
        projectId,
        sessionId: input.sessionId,
      })
      if (repair.stop_reason === "max_tokens" || repair.stop_reason === "refusal") {
        throw new Error(`Question reply repair stopped: ${repair.stop_reason}`)
      }
      const repairedCall = repair.content.find((block) =>
        block.type === "tool_use" && block.name === colorsThinResponseTool.name)
      if (!repairedCall || repairedCall.type !== "tool_use") {
        throw new Error("Question reply repair missing")
      }
      const repaired = record(repairedCall.input)
      if (typeof repaired.reply !== "string" || !repaired.reply.trim() || repaired.close !== false ||
        !["none", "consent", "safety"].includes(String(repaired.boundary)) ||
        typeof repaired.boundaryQuestion !== "string" ||
        !oneQuestion(repaired.reply).includes("?")) {
        throw new Error("Question reply repair malformed")
      }
      proposal = {
        reply: repaired.reply.trim(),
        close: false,
        boundary: repaired.boundary as ConversationReply["boundary"],
        boundaryQuestion: repaired.boundaryQuestion.trim(),
        interactionProposal: repaired.interactionProposal,
      }
    }
    if (!applicantQuestion && turnCount >= emergencyLimit &&
      proposal.boundary !== "consent" &&
      (!proposal.close || proposal.reply.includes("?"))) {
      const repair = await new Anthropic().messages.create({
        model,
        max_tokens: 300,
        system: colorsThinConversationPrompt({
          objective: COLORS_FORUM_MEMBERSHIP_OBJECTIVE,
          turnCount,
          mediaCatalog: colorsInteractionCatalog(shows),
        }) + "\n\nThe emergency limit is reached. The previous proposal did not provide a usable close. Set close=true and write only a brief, specific acknowledgment of the applicant's latest point. No question, verdict, promise, or generic farewell; the runtime adds the neutral final line.",
        messages: [...conversation, { role: "user", content: currentAnswer }],
        tools: [colorsThinResponseTool],
        tool_choice: { type: "tool", name: colorsThinResponseTool.name },
      })
      logLlmUsage({
        operation: "colors_thin_emergency_close_repair",
        provider: "anthropic",
        model,
        usage: repair.usage,
        requestId: input.requestId,
        organisationId,
        projectId,
        sessionId: input.sessionId,
      })
      const repairedCall = repair.content.find((block) =>
        block.type === "tool_use" && block.name === colorsThinResponseTool.name)
      if (repair.stop_reason === "max_tokens" || repair.stop_reason === "refusal" ||
        !repairedCall || repairedCall.type !== "tool_use") {
        throw new Error("Emergency close repair missing")
      }
      const repaired = record(repairedCall.input)
      if (typeof repaired.reply !== "string" || !repaired.reply.trim() ||
        repaired.close !== true || repaired.reply.includes("?") ||
        repaired.boundary !== "none" || repaired.boundaryQuestion !== "") {
        throw new Error("Emergency close repair malformed")
      }
      proposal = {
        reply: repaired.reply.trim(), close: true, boundary: "none", boundaryQuestion: "",
      }
    }
    const neutralClosingLine = settings.applicationExperience.closing_message?.trim() ||
      DEFAULT_APPLICATION_CLOSING_MESSAGE
    if (!applicantQuestion && proposal.close && proposal.boundary === "none" &&
      conversationalClosing(proposal.reply, neutralClosingLine) === neutralClosingLine) {
      const repair = await new Anthropic().messages.create({
        model,
        max_tokens: 300,
        system: colorsThinConversationPrompt({
          objective: COLORS_FORUM_MEMBERSHIP_OBJECTIVE,
          turnCount,
          mediaCatalog: colorsInteractionCatalog(shows),
        }) + "\n\nThe previous closing acknowledgment could not be shown because it contained a question, a decision or process claim, or no specific acknowledgment. Set close=true. In one short sentence, reflect a concrete point the applicant just made without endorsing it. Do not mention a review, next step, membership decision, or promise. The runtime adds the neutral final line.",
        messages: [...conversation, { role: "user", content: currentAnswer }],
        tools: [colorsThinResponseTool],
        tool_choice: { type: "tool", name: colorsThinResponseTool.name },
      })
      logLlmUsage({
        operation: "colors_thin_closing_acknowledgment_repair",
        provider: "anthropic",
        model,
        usage: repair.usage,
        requestId: input.requestId,
        organisationId,
        projectId,
        sessionId: input.sessionId,
      })
      const repairedCall = repair.content.find((block) =>
        block.type === "tool_use" && block.name === colorsThinResponseTool.name)
      if (repair.stop_reason !== "max_tokens" && repair.stop_reason !== "refusal" &&
        repairedCall?.type === "tool_use") {
        const repaired = record(repairedCall.input)
        if (typeof repaired.reply === "string" && repaired.close === true &&
          repaired.boundary === "none" && repaired.boundaryQuestion === "" &&
          conversationalClosing(repaired.reply, neutralClosingLine) !== neutralClosingLine) {
          proposal = {
            reply: repaired.reply.trim(), close: true, boundary: "none", boundaryQuestion: "",
          }
        }
      }
    }
  } catch (error) {
    log.error("colors_thin_conversation_failed", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      detail: error instanceof Error ? error.message : String(error),
    })
    return json({ error: "Groucho could not respond. Please try again." }, input.requestId, 503)
  }

  const previousBoundary = record(lastAssistant?.metadata).boundary
  const firstBoundaryTurn = proposal.boundary === "consent" && previousBoundary !== "consent"
  const repeatedConsentBoundary = proposal.boundary === "consent" && previousBoundary === "consent"
  const requestedClose = !applicantQuestion && !firstBoundaryTurn &&
    (proposal.close || repeatedConsentBoundary || turnCount >= emergencyLimit)
  if (firstBoundaryTurn && (!proposal.boundaryQuestion.endsWith("?") ||
    !/\b(?:consent|permission|ask|agree|approval)\b/i.test(proposal.boundaryQuestion))) {
    log.error("colors_thin_boundary_question_invalid", {
      requestId: input.requestId, sessionId: input.sessionId,
    })
    return json({ error: "Groucho could not respond. Please try again." }, input.requestId, 503)
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
      ? `${boundaryStatement} ${proposal.boundaryQuestion}`.trim()
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
  return json({
    message: reply,
    status: close ? "completed" : "active",
    reviewStatus: close ? "pending" : "not_ready",
    ui,
  }, input.requestId)
}
