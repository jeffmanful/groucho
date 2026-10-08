import { NextRequest, NextResponse } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { demoSession } from "@/lib/colors-demo-token"
import { normaliseMediaChoiceAnswer } from "@/lib/gatekeeper-interaction-spec"
import { postSessionMessage } from "@/lib/post-session-message"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { COLORS_THIN_PILOT_MARKER, postColorsThinConversation } from "@/lib/colors-thin-conversation"
import { supabase } from "@/lib/supabase"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message || !sessionId) return NextResponse.json({ error: "Missing message or session" }, { status: 400 })
  if (!(await demoSession(req, sessionId))) {
    return NextResponse.json({ error: "Unauthorized demo session" }, { status: 401 })
  }
  const applicant = parseApplicantIdentity(body?.applicant)
  if (!applicant.ok || !applicant.value) {
    return NextResponse.json({ error: "Applicant email is required" }, { status: 400 })
  }
  const interactionAnswer = body?.interactionAnswer === undefined
    ? undefined
    : normaliseMediaChoiceAnswer(body.interactionAnswer)
  if (body?.interactionAnswer !== undefined && !interactionAnswer) {
    return NextResponse.json({ error: "Invalid interaction answer" }, { status: 400 })
  }
  const project = await colorsDemoProject()
  if (!project) return NextResponse.json({ error: "COLORS Forum demo is not configured" }, { status: 503 })
  const { data: session, error: sessionError } = await supabase.from("sessions")
    .select("id")
    .eq("session_id", sessionId)
    .eq("project_id", project.context.projectId)
    .maybeSingle()
  if (sessionError) return NextResponse.json({ error: "Session unavailable" }, { status: 503 })
  if (session) {
    const { data: opening, error: openingError } = await supabase.from("messages")
      .select("metadata")
      .eq("session_id", session.id)
      .eq("role", "assistant")
      .order("sent_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    if (openingError || !opening) {
      return NextResponse.json({ error: "Session opening unavailable" }, { status: 503 })
    }
    const metadata = opening?.metadata && typeof opening.metadata === "object" && !Array.isArray(opening.metadata)
      ? opening.metadata as Record<string, unknown> : {}
    if (metadata.conversation_engine === COLORS_THIN_PILOT_MARKER) {
      return postColorsThinConversation({
        context: project.context,
        sessionId,
        message,
        applicant: applicant.value,
        interactionAnswer,
        requestId: getOrCreateRequestId(req),
      })
    }
  }
  return postSessionMessage({
    authorization: null,
    sessionId,
    message,
    applicantIdentity: applicant.value,
    interactionAnswer,
    projectId: project.context.projectId,
    demoProjectContext: project.context,
    demoReviewerPreview: true,
    requestId: getOrCreateRequestId(req),
    incomingHeaders: req.headers,
  })
}
