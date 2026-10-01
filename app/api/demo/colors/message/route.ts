import { NextRequest, NextResponse } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { demoSession } from "@/lib/colors-demo-token"
import { normaliseMediaChoiceAnswer } from "@/lib/gatekeeper-interaction-spec"
import { postSessionMessage } from "@/lib/post-session-message"
import { getOrCreateRequestId } from "@/lib/request-trace"

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
