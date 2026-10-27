import { NextRequest, NextResponse } from "next/server"
import { parseHumanApplicationDecision } from "@/lib/application-decision"
import { correctApplicationDecision } from "@/lib/application-decision-correction"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"

/**
 * Correct a decision from the dashboard. Body: { expectedDecisionId, decision, reason, applicantReason? }.
 * Corrections come from the client's own owners and admins, not from Groucho staff.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string; sessionId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId, sessionId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny
  if (actor.kind === "platform") {
    return NextResponse.json(
      { error: "Corrections come from the organisation's own owners and admins." },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => null)) as {
    expectedDecisionId?: unknown
    decision?: unknown
    reason?: unknown
    applicantReason?: unknown
  } | null
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const decision = parseHumanApplicationDecision(body.decision)
  if (!decision) return NextResponse.json({ error: "decision must be approved or declined" }, { status: 400 })
  if (typeof body.expectedDecisionId !== "string" || !body.expectedDecisionId) {
    return NextResponse.json({ error: "expectedDecisionId is required" }, { status: 400 })
  }

  const result = await correctApplicationDecision({
    organisationId: orgId,
    projectId,
    sessionId,
    expectedDecisionId: body.expectedDecisionId,
    decision,
    reason: typeof body.reason === "string" ? body.reason : "",
    applicantReason: typeof body.applicantReason === "string" ? body.applicantReason : null,
    reviewer: { kind: "member", userId: actor.userId, email: actor.email },
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...(result.current ? { current: result.current } : {}) }, { status: result.status })
  }
  return NextResponse.json({
    decision: result.decision,
    replaced: result.replaced,
    reviewStatus: result.decision.decision,
    ...(result.accessSecret ? { accessSecret: result.accessSecret } : {}),
  })
}
