import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { resolvePlaygroundProjectContext } from "@/lib/playground-projects"
import { startOnboardingSession } from "@/lib/start-onboarding-session"
import { getOrCreateRequestId } from "@/lib/request-trace"

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req)
  let body: { sessionId?: string; projectId?: string; personaId?: string }
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
  if (settings.projectType !== "onboarding") {
    return NextResponse.json(
      { error: "Project is not an onboarding project" },
      { status: 400 },
    )
  }

  return startOnboardingSession({
    sessionId,
    personaId: body.personaId?.trim() || undefined,
    allowMissingApplicantIdentity: true,
    requestId,
    context: resolved.context,
    projectSettings: settings,
  })
}
