import { NextRequest, NextResponse } from "next/server"
import { resolvePersonaPreview, loadPersonaPreviewSession } from "@/lib/persona-preview"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { parseApplicantIdentity, applicantIdentityFromRow } from "@/lib/applicant-identity"
import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { COLORS_THIN_PILOT_MARKER, postColorsThinConversation } from "@/lib/colors-thin-conversation"
import { normaliseMediaChoiceAnswer } from "@/lib/gatekeeper-interaction-spec"
import { colorsThinEventStream, wantsColorsThinStream } from "@/lib/colors-thin-stream"
import { selectableColorsThinModel } from "@/lib/colors-thin-model-options"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { checkRateLimit } from "@/lib/rate-limit"
import { supabase } from "@/lib/supabase"

type RouteContext = { params: Promise<{ orgId: string; personaId: string; action: string }> }
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })

async function handle(req: NextRequest, { params }: RouteContext) {
  const { orgId, personaId, action } = await params
  if (!(req.method === "GET" ? ["project", "state"] : ["start", "message"]).includes(action)) {
    return json({ error: "Not found" }, 404)
  }
  if (req.method === "POST" && !isSameOriginMutation(req)) return json({ error: "Invalid request origin." }, 403)
  const preview = await resolvePersonaPreview(orgId, personaId)
  if (preview instanceof NextResponse) return preview
  if (action === "project") return json({ project: preview.option })
  const body = req.method === "POST" ? await req.json().catch(() => null) : null
  const sessionId = req.method === "POST" ? body?.sessionId : req.nextUrl.searchParams.get("sessionId")
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: "Invalid session" }, 400)
  const session = await loadPersonaPreviewSession(preview, sessionId)
  if (session instanceof NextResponse) return session
  if (action === "state") {
    if (!session) return json({ error: "Session not found" }, 404)
    const { data: last, error } = await supabase.from("messages")
      .select("content, metadata")
      .eq("session_id", session.id)
      .eq("role", "assistant")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return json({ error: "Preview unavailable" }, 503)
    return json({
      status: session.status,
      applicantEmail: session.applicant_email,
      applicant: applicantIdentityFromRow(session),
      message: last?.content,
      ui: last?.metadata?.ui,
    })
  }
  if (!checkRateLimit({ namespace: "persona-preview", key: preview.snapshot.actor, limit: 30, windowMs: 60_000 }).ok) {
    return json({ error: "Please wait a minute before trying again." }, 429)
  }
  const applicant = parseApplicantIdentity(body?.applicant)
  if (!applicant.ok || !applicant.value) return json({ error: "Applicant email is required" }, 400)
  const requestId = getOrCreateRequestId(req)
  if (action === "start") {
    if (!session && body?.previewVersion !== preview.snapshot.version) {
      return json({ error: "This persona has changed. Restart with latest changes to try the saved version." }, 409)
    }
    const response = await startGatekeeperSession({
      sessionId,
      personaId,
      applicantIdentity: applicant.value,
      context: preview.context,
      projectSettings: preview.context.settings,
      conversationEngine: COLORS_THIN_PILOT_MARKER,
      demoSession: true,
      personaPreview: preview.snapshot,
      requestId,
    })
    if (!response.ok) return response
    // Also check the winner of a concurrent start before exposing its response.
    const created = await loadPersonaPreviewSession(preview, sessionId)
    if (created instanceof NextResponse) return created
    if (!created) return json({ error: "Preview could not be started. Please retry." }, 503)
    return response
  }
  if (!session) return json({ error: "Start a preview first." }, 404)
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message || message.length > 20_000) return json({ error: "Enter a message of up to 20,000 characters." }, 400)
  const interactionAnswer = body?.interactionAnswer === undefined ? undefined : normaliseMediaChoiceAnswer(body.interactionAnswer)
  if (body?.interactionAnswer !== undefined && !interactionAnswer) return json({ error: "Invalid interaction answer" }, 400)
  const turn = {
    context: preview.context,
    sessionId,
    message,
    applicant: applicant.value,
    interactionAnswer,
    personaPrompt: session.snapshot.prompt,
    requestId,
    modelOverride: selectableColorsThinModel(body?.conversationModel),
    runCompletion: false,
  }
  if (wantsColorsThinStream(req.headers.get("accept"))) {
    return colorsThinEventStream((onReplyDelta) => postColorsThinConversation({ ...turn, onReplyDelta }))
  }
  return postColorsThinConversation(turn)
}

async function route(req: NextRequest, context: RouteContext) {
  try {
    return await handle(req, context)
  } catch {
    return json({ error: "Persona preview is unavailable. Please retry." }, 503)
  }
}

export { route as GET, route as POST }
