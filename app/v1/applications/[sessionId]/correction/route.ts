import { NextRequest, NextResponse } from "next/server"
import { resolveApplicationsKey } from "@/lib/api-key-scopes"
import { parseHumanApplicationDecision } from "@/lib/application-decision"
import { correctApplicationDecision } from "@/lib/application-decision-correction"
import { supabase } from "@/lib/supabase"

/**
 * Correct a decision from a client's own app. Body:
 * { decision, reason, applicantReason?, expectedDecisionId?, reviewer?: { email?, name? } }.
 * The old decision stays in the history; Groucho sends application.decision_corrected.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const key = await resolveApplicationsKey(req.headers.get("authorization"))
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status })
  const { organisationId, projectId, apiKeyId } = key.context
  const clientKey = decodeURIComponent((await params).sessionId).trim()

  const body = (await req.json().catch(() => null)) as {
    decision?: unknown
    reason?: unknown
    applicantReason?: unknown
    expectedDecisionId?: unknown
    reviewer?: { email?: unknown; name?: unknown } | null
  } | null
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  const decision = parseHumanApplicationDecision(body.decision)
  if (!decision) return NextResponse.json({ error: "decision must be approved or declined" }, { status: 400 })
  const reviewerEmail = typeof body.reviewer?.email === "string" ? body.reviewer.email.trim() : ""
  if (reviewerEmail && !/^[^\s@]+@[^\s@]+$/.test(reviewerEmail)) {
    return NextResponse.json({ error: "reviewer.email must be an email address" }, { status: 400 })
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select("id")
    .eq("project_id", projectId)
    .eq("session_id", clientKey)
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 })
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const result = await correctApplicationDecision({
    organisationId,
    projectId,
    sessionId: session.id as string,
    expectedDecisionId: typeof body.expectedDecisionId === "string" ? body.expectedDecisionId : null,
    decision,
    reason: typeof body.reason === "string" ? body.reason : "",
    applicantReason: typeof body.applicantReason === "string" ? body.applicantReason : null,
    reviewer: {
      kind: "api",
      apiKeyId,
      email: reviewerEmail || null,
      name: typeof body.reviewer?.name === "string" ? body.reviewer.name : null,
    },
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(
    {
      sessionId: clientKey,
      reviewStatus: result.decision.decision,
      decision: {
        id: result.decision.id,
        decision: result.decision.decision,
        source: "human",
        via: "api",
        reason: result.decision.reason,
        applicantReason: result.decision.applicant_reason,
        decidedAt: result.decision.created_at,
      },
      replaced: result.replaced,
      ...(result.accessSecret ? { accessSecret: result.accessSecret } : {}),
    },
    { status: 201 },
  )
}
