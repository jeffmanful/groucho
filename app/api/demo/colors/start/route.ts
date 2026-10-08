import { NextRequest, NextResponse } from "next/server"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import {
  DEMO_SESSION_COOKIE,
  demoTester,
  issueDemoToken,
} from "@/lib/colors-demo-token"
import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { COLORS_THIN_PILOT_MARKER } from "@/lib/colors-thin-conversation"

export async function POST(req: NextRequest) {
  const tester = await demoTester(req)
  if (!tester) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 })
  }
  const applicant = parseApplicantIdentity(body?.applicant)
  if (!applicant.ok || !applicant.value) {
    return NextResponse.json({ error: "Applicant email is required" }, { status: 400 })
  }
  const project = await colorsDemoProject()
  if (!project) return NextResponse.json({ error: "COLORS Forum demo is not configured" }, { status: 503 })
  const response = await startGatekeeperSession({
    sessionId,
    applicantIdentity: applicant.value,
    requestId: getOrCreateRequestId(req),
    context: project.context,
    projectSettings: project.context.settings,
    conversationEngine:
      process.env.GROUCHO_COLORS_THIN_PILOT === "1"
        ? COLORS_THIN_PILOT_MARKER
        : undefined,
  })
  if (!response.ok) return response
  const token = await issueDemoToken({
    kind: "session", email: tester.email, sessionId, issuedAt: Date.now(),
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
