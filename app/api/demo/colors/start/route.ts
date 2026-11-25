import { NextRequest, NextResponse } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { authorizeColorsDemo } from "@/lib/shared-colors-demo"
import {
  DEMO_SESSION_COOKIE,
  issueDemoToken,
} from "@/lib/colors-demo-token"
import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { COLORS_THIN_PILOT_MARKER } from "@/lib/colors-thin-conversation"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const clientId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 })
  }
  const access = await authorizeColorsDemo(req, "start", clientId)
  if (access instanceof NextResponse) return access
  const { project, tester, link, sessionId } = access
  const applicant = parseApplicantIdentity(body?.applicant)
  if (!applicant.ok || !applicant.value) {
    return NextResponse.json({ error: !applicant.ok ? applicant.error : "Applicant email is required" }, { status: 400 })
  }
  if (link && Boolean(applicant.value.artist) !== (link.variant === "artist")) {
    return NextResponse.json({ error: "This link is for a different demo walkthrough." }, { status: 400 })
  }
  const response = await startGatekeeperSession({
    sessionId,
    applicantIdentity: applicant.value,
    requestId: getOrCreateRequestId(req),
    context: project.context,
    projectSettings: project.context.settings,
    // Every COLORS application now runs on the newer conversation engine.
    conversationEngine: COLORS_THIN_PILOT_MARKER,
    demoSession: true,
    sharedDemoPreview: Boolean(link),
  })
  if (!response.ok || !tester) return response
  const token = await issueDemoToken({
    kind: "session", email: tester.email, access: tester.access, sessionId, issuedAt: Date.now(),
  })
  if (!token) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  response.cookies.set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/demo/colors",
    maxAge: 60 * 60 * 24,
    secure: process.env.NODE_ENV === "production",
  })
  return response
}
