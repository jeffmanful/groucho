import type { NextResponse } from "next/server"
import type { ApplicantIdentity } from "@/lib/applicant-identity"
import { COLORS_THIN_PILOT_MARKER, projectUsesColorsEngine } from "@/lib/colors-engine"
import { postColorsThinConversation } from "@/lib/colors-thin-conversation"
import type { MediaChoiceAnswer } from "@/lib/gatekeeper-interaction-spec"
import type { ProjectContext } from "@/lib/project-resolution"
import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { supabase } from "@/lib/supabase"

export type ColorsEngineRoute = "colors" | "colors-demo" | "start-colors" | "standard"

/**
 * Which engine answers this turn. A session keeps the engine it started on, so conversations
 * already in progress finish where they began. A new session on a project configured with
 * `conversation_engine: "colors_forum"` starts on the newer engine.
 */
export async function colorsEngineRoute(input: {
  projectId: string
  sessionId: string
  rawSettings: unknown
}): Promise<ColorsEngineRoute> {
  const { data: session, error } = await supabase.from("sessions")
    .select("id")
    .eq("session_id", input.sessionId)
    .eq("project_id", input.projectId)
    .maybeSingle()
  if (error) throw error
  if (!session) return projectUsesColorsEngine(input.rawSettings) ? "start-colors" : "standard"
  const { data: opening, error: openingError } = await supabase.from("messages")
    .select("metadata")
    .eq("session_id", session.id)
    .eq("role", "assistant")
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (openingError) throw openingError
  const metadata = opening?.metadata && typeof opening.metadata === "object" && !Array.isArray(opening.metadata)
    ? opening.metadata as Record<string, unknown> : {}
  if (metadata.conversation_engine !== COLORS_THIN_PILOT_MARKER) return "standard"
  // Demo sessions live on the real Forum project; an API turn on one must not reach its webhooks.
  return metadata.colors_demo_session === true ? "colors-demo" : "colors"
}

/**
 * Answer a turn on the newer engine. A client that posts before calling start gets the session
 * started first; its message is then treated as the answer to the opening question.
 */
export async function postColorsEngineTurn(input: {
  route: Exclude<ColorsEngineRoute, "standard">
  context: ProjectContext
  sessionId: string
  message: string
  applicant?: ApplicantIdentity | null
  interactionAnswer?: MediaChoiceAnswer
  requestId?: string
  likelyBot: boolean
}): Promise<NextResponse> {
  if (input.route === "start-colors") {
    const started = await startGatekeeperSession({
      sessionId: input.sessionId,
      applicantIdentity: input.applicant ?? null,
      requestId: input.requestId,
      context: input.context,
      projectSettings: input.context.settings,
      conversationEngine: COLORS_THIN_PILOT_MARKER,
    })
    if (!started.ok) return started
  }
  return postColorsThinConversation({
    context: input.context,
    sessionId: input.sessionId,
    message: input.message,
    applicant: input.applicant ?? undefined,
    interactionAnswer: input.interactionAnswer,
    requestId: input.requestId,
    likelyBot: input.likelyBot,
    runCompletion: input.route !== "colors-demo",
  })
}
