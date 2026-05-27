import { NextRequest } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { resolveProjectContext } from "@/lib/project-resolution"
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
  if (settings.projectType !== "onboarding") {
    return tracedJson(
      req,
      { error: "Project is not an onboarding project" },
      { status: 400 },
    )
  }

  const { sessionId: rawId } = await params
  const sessionId = decodeURIComponent(rawId).trim()
  if (sessionId.length < 8 || sessionId.length > 128) {
    return tracedJson(req, { error: "Invalid sessionId" }, { status: 400 })
  }

  let body: { personaId?: string | null; applicant?: unknown } = {}
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

  return startOnboardingSession({
    sessionId,
    personaId: body.personaId ?? undefined,
    applicantIdentity: applicant.value,
    requestId,
    context: projectResolved.context,
    projectSettings: settings,
  })
}
