import { NextRequest, NextResponse } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { authorizeColorsDemo } from "@/lib/shared-colors-demo"
import { normaliseMediaChoiceAnswer } from "@/lib/gatekeeper-interaction-spec"
import { postSessionMessage } from "@/lib/post-session-message"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { COLORS_THIN_PILOT_MARKER, postColorsThinConversation } from "@/lib/colors-thin-conversation"
import { postDemoConversation } from "@/lib/demo-conversation-profiles"
import { supabase } from "@/lib/supabase"
import { colorsThinEventStream, wantsColorsThinStream } from "@/lib/colors-thin-stream"
import { selectableColorsThinModel } from "@/lib/colors-thin-model-options"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const clientId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message || !clientId) return NextResponse.json({ error: "Missing message or session" }, { status: 400 })
  const access = await authorizeColorsDemo(req, "session", clientId)
  if (access instanceof NextResponse) return access
  const { project, sessionId } = access
  if (access.link && message.length > 20_000) {
    return NextResponse.json({ error: "Enter a message of up to 20,000 characters." }, { status: 400 })
  }
  const applicant = parseApplicantIdentity(body?.applicant)
  if (!applicant.ok || !applicant.value) {
    return NextResponse.json({ error: !applicant.ok ? applicant.error : "Applicant email is required" }, { status: 400 })
  }
  if (access.link && Boolean(applicant.value.artist) !== (access.link.variant === "artist")) {
    return NextResponse.json({ error: "This link is for a different demo walkthrough." }, { status: 400 })
  }
  const interactionAnswer = body?.interactionAnswer === undefined
    ? undefined
    : normaliseMediaChoiceAnswer(body.interactionAnswer)
  if (body?.interactionAnswer !== undefined && !interactionAnswer) {
    return NextResponse.json({ error: "Invalid interaction answer" }, { status: 400 })
  }
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
      const turn = {
        context: project.context,
        sessionId,
        message,
        applicant: applicant.value,
        interactionAnswer,
        requestId: getOrCreateRequestId(req),
        // Tester choice from the demo settings; anything outside the allowed list uses the default.
        modelOverride: access.link ? undefined : selectableColorsThinModel(body?.conversationModel),
        // Demo sessions use the real Forum project, so its webhooks and decision policy stay out of it.
        runCompletion: false,
      }
      const isAuthoredDemo = access.link && typeof metadata.conversation_profile === "string" &&
        metadata.conversation_profile.startsWith("project:")
      const respond = isAuthoredDemo ? postDemoConversation : postColorsThinConversation
      // Streaming is opt-in by Accept header; the final event carries the same body and status.
      return wantsColorsThinStream(req.headers.get("accept"))
        ? colorsThinEventStream(onReplyDelta => respond({ ...turn, onReplyDelta }))
        : respond(turn)
    }
  }
  if (access.link) return NextResponse.json({ error: "Start a demo conversation first." }, { status: 404 })
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
