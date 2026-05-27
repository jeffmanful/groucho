import { NextRequest } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { resolveAdminActor } from "@/lib/admin-actor"
import { postSessionMessage } from "@/lib/post-session-message"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { tracedJson } from "@/lib/with-request-trace"

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req)
  let body: {
    message: string
    sessionId: string
    personaId?: string
    projectId?: string
    applicant?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return tracedJson(req, { error: "Invalid request" }, { status: 400 })
  }

  const { message, sessionId, personaId, projectId } = body
  if (!message?.trim() || !sessionId?.trim()) {
    return tracedJson(
      req,
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  const applicant = parseApplicantIdentity(body.applicant)
  if (!applicant.ok) {
    return tracedJson(req, { error: applicant.error }, { status: 400 })
  }

  const projectIdTrimmed = projectId?.trim() || undefined
  const playgroundActor = projectIdTrimmed
    ? await resolveAdminActor()
    : null

  return postSessionMessage({
    authorization: req.headers.get("authorization"),
    sessionId: sessionId.trim(),
    message: message.trim(),
    personaId: personaId?.trim() || undefined,
    applicantIdentity: applicant.value,
    projectId: projectIdTrimmed,
    playgroundActor,
    requestId,
    incomingHeaders: req.headers,
  })
}
