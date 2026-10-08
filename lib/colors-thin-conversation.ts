import Anthropic from "@anthropic-ai/sdk"
import { NextResponse } from "next/server"
import type { ApplicantIdentity } from "@/lib/applicant-identity"
import { COLORS_FORUM_PERSONA_PROMPT } from "@/lib/colors-forum-persona"
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
  softTarget: number
  mediaCatalog: ReturnType<typeof colorsInteractionCatalog>
}): string {
  return `${COLORS_FORUM_PERSONA_PROMPT.split("\n\nMake a private advisory judgment for COLORS.")[0]}

Current project objective: ${input.objective}

Give this conversation a loose arc: learn why the person came; hear one concrete example of their relationship with music or community; understand what they hope to find or contribute; follow the most revealing detail once; then close. These are purposes, not required questions or a fixed order. An answer may cover several purposes. Skip what is already understood. Follow a more meaningful thread when one appears. Do not ask a second example just to fill a category. An account of a music discussion can already show curiosity, participation and openness; a simple wish to share music can already tell you what someone might bring. Do not keep probing the mechanics or hidden motive of an ordinary contribution after the person has answered. A human reviewer can assess a brief, imperfect answer without another interrogation.

Speak as Groucho, not as a reviewer. Respond to a specific detail, then ask one clear question at most. Vary the wording and route with the person. Do not announce stages, score, classify evidence, or mention an application checklist. A request to clarify or change topic deserves a direct response. Ordinary discussion, recommendations and links to publicly released music are normal Forum participation. Do not introduce a permission, copyright, remixing or reposting test because someone says they share music or references. Do not ask them to prove that routine sharing is safe. If the person themselves raises sharing private or unreleased artist work without prior permission, state the artist's consent boundary promptly and plainly. On that first boundary turn, put a brief statement only in reply and one model-written question about prior permission in boundaryQuestion. Do not ask about taste, reach, contacts, or another topic while that concrete concern is unresolved. On a repeated refusal, close rather than open another topic. Set boundary to consent or safety only when the applicant's own words actually raise that issue; Groucho's hypothetical question cannot create the concern. Otherwise boundaryQuestion must be empty.

This is answer ${input.turnCount} of an approximate ${input.softTarget}-answer conversation. The target is guidance, not a minimum. Close when a human reviewer would have a useful conversation to read, even if some topics were not explored. Once the arc has a concrete example and a Forum hope or contribution, prefer a warm close to another clarification. Do not keep asking merely because a topic remains unknown. The runtime will stop a loop at a higher emergency limit.

Approved media catalog: ${JSON.stringify(input.mediaCatalog)}. Media is optional. Offer it only when it helps this person's current thread or they ask to see a source. Use only listed IDs. Never imply they watched or understood an asset before they say so. A reference uses one or two image/link cards; a choice uses two to four videos with a rationale. The reply must still make sense if media cannot be shown. Omit interactionProposal for an ordinary text turn or an unresolved boundary.

Call groucho_converse exactly once. The reply is applicant-facing. close means the conversation is finished, not that an applicant has passed or failed. On close, the runtime supplies the neutral closing message.`
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

/** Keep the first invitation when the model accidentally combines questions. */
export function oneQuestion(reply: string): string {
  const first = reply.indexOf("?")
  return first >= 0 && reply.indexOf("?", first + 1) >= 0
    ? reply.slice(0, first + 1).trim()
    : reply
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
  const softTarget = Math.min(5, configuredMaxTurns)
  const emergencyLimit = Math.min(8, Math.max(1, configuredMaxTurns))
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
        objective: "Understand how this person relates to music and community, what they hope to find in the COLORS Forum, and what they might bring to it.",
        turnCount,
        softTarget,
        mediaCatalog: colorsInteractionCatalog(shows),
      }),
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
  const close = !firstBoundaryTurn && (proposal.close || repeatedConsentBoundary || turnCount >= emergencyLimit)
  if (firstBoundaryTurn && (!proposal.boundaryQuestion.endsWith("?") ||
    !/\b(?:consent|permission|ask|agree|approval)\b/i.test(proposal.boundaryQuestion))) {
    log.error("colors_thin_boundary_question_invalid", {
      requestId: input.requestId, sessionId: input.sessionId,
    })
    return json({ error: "Groucho could not respond. Please try again." }, input.requestId, 503)
  }
  const rich = !close && proposal.boundary === "none"
    ? resolveApplicationRichInteraction(proposal.interactionProposal, shows)
    : null
  const ui = rich?.kind === "reference"
    ? { ...DEFAULT_INTERACTION_SPEC, inputType: "text" as const, referenceCards: rich.cards }
    : rich?.kind === "choice"
      ? { ...DEFAULT_INTERACTION_SPEC, inputType: "mediaChoice" as const, mediaChoice: rich.interaction }
      : DEFAULT_INTERACTION_SPEC
  const boundaryStatement = proposal.reply.split(/\n\s*\n/)[0]
    .replace(/\s*[^.!?]*\?[\s\S]*$/, "").trim()
  const reply = close
    ? settings.applicationExperience.closing_message?.trim() || DEFAULT_APPLICATION_CLOSING_MESSAGE
    : firstBoundaryTurn
      ? `${boundaryStatement} ${proposal.boundaryQuestion}`.trim()
      : oneQuestion(rich?.question ?? proposal.reply)

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
