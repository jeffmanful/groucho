import { NextRequest } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import {
  parseOpeningInteraction,
  parseOpeningMessage,
} from "@/lib/opening-message"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { readApplicantSignals, scheduleApplicantSignals } from "@/lib/applicant-signals"
import { resolveProjectContext } from "@/lib/project-resolution"
import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { startOnboardingSession } from "@/lib/start-onboarding-session"
import { tracedJson } from "@/lib/with-request-trace"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const requestId = getOrCreateRequestId(req)
  const authHeader = req.headers.get("authorization")
  const projectResolved = await resolveProjectContext(authHeader)
  if (!projectResolved.ok) {
    return tracedJson(req, projectResolved.body, {
      status: projectResolved.status,
    })
  }

  const settings = projectResolved.context.settings
  if (settings.projectType === "ticket_access") return tracedJson(req, { error: "Ticket access is simulation-only. Open the admin ticket workspace." }, { status: 409 })

  const { sessionId: rawId } = await params
  const sessionId = decodeURIComponent(rawId).trim()
  if (sessionId.length < 8 || sessionId.length > 128) {
    return tracedJson(req, { error: "Invalid sessionId" }, { status: 400 })
  }

  let body: {
    personaId?: string | null
    applicant?: unknown
    openingMessage?: unknown
    openingInteraction?: unknown
    invitationToken?: string
  } = {}
  try {
    const text = await req.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return tracedJson(req, { error: "Invalid request" }, { status: 400 })
  }

  const applicant = parseApplicantIdentity(body.applicant)
  if (!applicant.ok) {
    return tracedJson(req, { error: applicant.error }, { status: 400 })
  }

  const opening = parseOpeningMessage(body.openingMessage)
  if (!opening.ok) {
    return tracedJson(req, { error: opening.error }, { status: 400 })
  }

  const openingInteraction = parseOpeningInteraction(body.openingInteraction)
  if (!openingInteraction.ok) {
    return tracedJson(req, { error: openingInteraction.error }, { status: 400 })
  }

  const startInput = {
    sessionId,
    invitationToken: typeof body.invitationToken === "string" ? body.invitationToken : undefined,
    personaId: body.personaId ?? undefined,
    applicantIdentity: applicant.value,
    openingMessage: opening.value,
    openingInteraction: openingInteraction.value,
    requestId,
    context: projectResolved.context,
    projectSettings: settings,
  }

  const response = settings.projectType === "onboarding"
    ? await startOnboardingSession(startInput)
    : await startGatekeeperSession(startInput)
  if (response.ok) {
    scheduleApplicantSignals(
      { projectId: projectResolved.context.projectId, sessionKey: sessionId },
      readApplicantSignals(req.headers, { viaApiKey: Boolean(projectResolved.context.apiKeyId) }),
    )
  }
  return response
}
