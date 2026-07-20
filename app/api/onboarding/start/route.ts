import { NextRequest, NextResponse } from "next/server"
import {
  parseOpeningInteraction,
  parseOpeningMessage,
} from "@/lib/opening-message"
import { resolveAdminActor } from "@/lib/admin-actor"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { resolvePlaygroundProjectContext } from "@/lib/playground-projects"
import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { startOnboardingSession } from "@/lib/start-onboarding-session"
import { getOrCreateRequestId } from "@/lib/request-trace"

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req)
  let body: {
    sessionId?: string
    projectId?: string
    personaId?: string
    applicant?: unknown
    openingMessage?: unknown
    openingInteraction?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const sessionId = body.sessionId?.trim()
  const projectId = body.projectId?.trim()
  if (!sessionId || sessionId.length < 8) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 })
  }
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 })
  }

  const actor = await resolveAdminActor()
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const resolved = await resolvePlaygroundProjectContext(actor, projectId)
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status })
  }

  const settings = resolved.context.settings
  const applicant = parseApplicantIdentity(body.applicant)
  if (!applicant.ok) {
    return NextResponse.json({ error: applicant.error }, { status: 400 })
  }
  if (!applicant.value) {
    return NextResponse.json(
      { error: "applicant.email is required to start a session" },
      { status: 400 },
    )
  }
  const opening = parseOpeningMessage(body.openingMessage)
  if (!opening.ok) {
    return NextResponse.json({ error: opening.error }, { status: 400 })
  }

  const openingInteraction = parseOpeningInteraction(body.openingInteraction)
  if (!openingInteraction.ok) {
    return NextResponse.json({ error: openingInteraction.error }, { status: 400 })
  }

  const startInput = {
    sessionId,
    personaId: body.personaId?.trim() || undefined,
    openingMessage: opening.value,
    openingInteraction: openingInteraction.value,
    applicantIdentity: applicant.value,
    requestId,
    context: resolved.context,
    projectSettings: settings,
  }

  if (settings.projectType === "onboarding") {
    return startOnboardingSession(startInput)
  }

  return startGatekeeperSession(startInput)
}
